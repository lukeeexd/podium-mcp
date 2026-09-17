import { PodiumError } from './errors.js';

export interface PodiumClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
}

type QueryValue = string | number | boolean | undefined;

export interface RequestInitLite {
  query?: Record<string, QueryValue>;
  json?: unknown;
  text?: string;
}

export class PodiumClient {
  constructor(
    private readonly opts: PodiumClientOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  protected async request<T>(method: string, path: string, init: RequestInitLite = {}): Promise<T> {
    const url = new URL(this.opts.baseUrl + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers = new Headers({ accept: 'application/json' });
    if (this.opts.token) headers.set('authorization', `Bearer ${this.opts.token}`);

    let body: string | undefined;
    if (init.text !== undefined) {
      headers.set('content-type', 'text/plain');
      body = init.text;
    } else if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(init.json);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new PodiumError({ status: 0, method, path, body: msg, cause });
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new PodiumError({ status: res.status, method, path, body: raw });
    }
    if (raw.trim() === '') return {} as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return { raw } as T;
    }
  }
}
