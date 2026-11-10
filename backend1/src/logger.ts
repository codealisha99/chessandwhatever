const stamp = () => new Date().toISOString();
export const log = {
  info: (msg: string, meta?: object) => console.info(stamp(), "INFO", msg, meta ?? ""),
  warn: (msg: string, meta?: object) => console.warn(stamp(), "WARN", msg, meta ?? ""),
  error: (msg: string, err?: unknown) => console.error(stamp(), "ERROR", msg, err ?? ""),
};
