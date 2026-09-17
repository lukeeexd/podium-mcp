type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let current: Level = 'info';

function write(level: Level, msg: string, meta?: unknown): void {
  if (order[level] < order[current]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}`;
  process.stderr.write(meta === undefined ? `${line}\n` : `${line} ${JSON.stringify(meta)}\n`);
}

export const log = {
  setLevel(level: Level): void {
    current = level;
  },
  debug: (msg: string, meta?: unknown) => write('debug', msg, meta),
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
};
