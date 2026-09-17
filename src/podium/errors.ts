export class PodiumError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: string;

  constructor(args: { status: number; method: string; path: string; body: string; cause?: unknown }) {
    const detail = args.status === 0 ? `network error: ${args.body}` : `HTTP ${args.status}: ${args.body.slice(0, 500)}`;
    super(`Podium ${args.method} ${args.path} failed (${detail})`, { cause: args.cause });
    this.name = 'PodiumError';
    this.status = args.status;
    this.method = args.method;
    this.path = args.path;
    this.body = args.body;
  }
}
