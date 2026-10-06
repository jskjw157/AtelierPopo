/** Source adapters enumerate by anti-join on immutable source identity. A
 * timestamp cursor is informational only: old/tied source commits remain seen.
 * Bookkeeping never changes the caller's primary mutation result or exception. */
export class CircuitProjectionService {
  constructor({ repository, sources, clock = Date.now }) { Object.assign(this, { repository, sources, clock }); }
  async catchUp({ customerId }) {
    const cursors = {};
    try {
      for (const source of this.sources) {
        const rows = await source.unprojected({ customerId });
        for (const row of rows) {
          await this.repository.projectOnce({ customerId, sourceKind: source.kind, sourceId: row.sourceId, event: row.event, now: this.clock() });
          cursors[source.kind] = row.sourceId;
        }
      }
      return { ready: true, cursors };
    } catch { return { ready: false, cursors }; }
  }
}
