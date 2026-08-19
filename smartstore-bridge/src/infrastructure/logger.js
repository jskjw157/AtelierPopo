function emit(level, message, context) {
  const event = {
    time: new Date().toISOString(),
    level,
    message,
    ...(context ? { context } : {})
  };
  // MCP stdio에서 stdout은 프로토콜 전용이므로 모든 로그는 stderr로 보냅니다.
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

export const logger = {
  info(message, context) { emit('info', message, context); },
  warn(message, context) { emit('warn', message, context); },
  error(message, context) { emit('error', message, context); }
};
