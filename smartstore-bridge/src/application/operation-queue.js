function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class OperationQueue {
  constructor({ ledger, concurrency = 1, logger }) {
    this.ledger = ledger;
    this.concurrency = Math.max(1, Math.min(4, Number(concurrency) || 1));
    this.logger = logger;
    this.pending = [];
    this.active = 0;
    this.accepting = true;
    this.idleWaiters = new Set();
    this.ledger?.recoverInterruptedOperations?.();
  }

  stats() {
    return {
      accepting: this.accepting,
      concurrency: this.concurrency,
      active: this.active,
      pending: this.pending.length
    };
  }

  enqueue(operationId, task) {
    if (!this.accepting) throw new Error('작업 큐가 종료 중이라 새 작업을 받을 수 없습니다.');
    this.pending.push({ operationId, task });
    this.#drain();
  }

  #notifyIdle() {
    if (this.active !== 0 || this.pending.length !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  #drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      this.active += 1;
      Promise.resolve()
        .then(async () => {
          this.ledger.markOperation(item.operationId, 'running');
          this.logger?.info?.('HTTP operation started', { operationId: item.operationId });
          const result = await item.task();
          this.ledger.markOperation(item.operationId, 'succeeded', { result });
          this.logger?.info?.('HTTP operation succeeded', { operationId: item.operationId });
        })
        .catch(error => {
          const status = String(error.code || '').endsWith('_WRITE_OUTCOME_UNKNOWN') ? 'interrupted' : 'failed';
          this.ledger.markOperation(item.operationId, status, {
            error: {
              name: error.name,
              code: error.code,
              message: error.message
            }
          });
          this.logger?.error?.('HTTP operation failed', {
            operationId: item.operationId,
            status,
            name: error.name,
            code: error.code,
            message: error.message
          });
        })
        .finally(() => {
          this.active -= 1;
          this.#drain();
          this.#notifyIdle();
        });
    }
  }

  async onIdle(timeoutMs = 30_000) {
    if (this.active === 0 && this.pending.length === 0) return true;
    let timeout;
    const idle = new Promise(resolve => this.idleWaiters.add(() => resolve(true)));
    const timedOut = new Promise(resolve => {
      timeout = setTimeout(() => resolve(false), Math.max(1, Number(timeoutMs) || 30_000));
      timeout.unref?.();
    });
    const result = await Promise.race([idle, timedOut]);
    clearTimeout(timeout);
    return result;
  }

  async close({ timeoutMs = 30_000 } = {}) {
    this.accepting = false;
    const idle = await this.onIdle(timeoutMs);
    if (!idle) {
      this.logger?.warn?.('HTTP operation queue shutdown timed out', this.stats());
    }
    // Give final ledger writes a chance to flush before the DB is closed.
    await delay(10);
    return idle;
  }
}
