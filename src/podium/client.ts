import { PodiumError } from './errors.js';
import type { HealthResponse, Json, QualityProfileQuery, SettingsResponse } from './types.js';

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

  // ---- reads ----
  health(): Promise<HealthResponse> {
    return this.request('GET', '/api/health');
  }
  stats(): Promise<Json> {
    return this.request('GET', '/api/stats');
  }
  progress(): Promise<Json> {
    return this.request('GET', '/api/progress');
  }
  dead(): Promise<Json> {
    return this.request('GET', '/api/dead');
  }
  state(refresh = false): Promise<Json> {
    return this.request('GET', '/api/state', { query: { refresh: refresh ? 1 : undefined } });
  }
  searchStreams(query: string): Promise<Json> {
    return this.request('GET', '/api/streams', { query: { q: query } });
  }
  streamGroups(): Promise<Json> {
    return this.request('GET', '/api/stream-groups');
  }
  getOrdering(): Promise<Json> {
    return this.request('GET', '/api/ordering');
  }
  qualityProfile(q: QualityProfileQuery): Promise<Json> {
    return this.request('GET', '/api/quality-profile', {
      query: {
        minSamples: q.minSamples,
        eventOnly: q.eventOnly === undefined ? undefined : q.eventOnly ? 1 : 0,
        include: q.include,
        exclude: q.exclude,
      },
    });
  }
  ruleStatus(): Promise<Json> {
    return this.request('GET', '/api/rule-check');
  }
  nameNoise(query?: string): Promise<Json> {
    return this.request('GET', '/api/name-noise', { query: { q: query } });
  }
  getSettings(): Promise<SettingsResponse> {
    return this.request('GET', '/api/settings');
  }
  backup(): Promise<Json> {
    return this.request('GET', '/api/backup');
  }
  teamarrStatus(): Promise<Json> {
    return this.request('GET', '/api/teamarr-sync');
  }
}
