# Podium MCP Server Implementation Plan

> **Historical document.** This plan guided the initial implementation. Where it differs from the code, the code is authoritative.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, self-hosted MCP server in TypeScript that exposes Podium's HTTP API as typed MCP tools, shipped as a multi-arch Docker image via GitHub Actions.

**Architecture:** Three layers in one Node service: a typed `PodiumClient` wrapping `fetch`; tool modules that validate input with zod, call the client and shape results; an entrypoint that reads env config and starts either a streamable HTTP transport (Express, stateful sessions) or stdio. Destructive tools require `confirm: true` and are only registered behind an env flag.

**Tech Stack:** Node 22, TypeScript 5, `@modelcontextprotocol/sdk` 1.30, zod 4, Express 5, Vitest 3, ESLint 9 with typescript-eslint, Docker multi-stage on `node:22-alpine`, GitHub Actions publishing to GHCR.

**Spec:** `docs/superpowers/specs/2026-09-17-podium-mcp-design.md`

## Global Constraints

- The repo is public. No file may contain a real LAN address, a real deployment port, a provider name, a group name or any other detail of the author's setup. Use `http://<podium-host>:<port>` or `http://podium.example:3000` in docs.
- No environment variable has a default that points at a real host. `PODIUM_URL` is required and has no default.
- Node `>=22`. ESM only (`"type": "module"`), TypeScript `module: NodeNext`, imports use `.js` extensions.
- All tool names are prefixed `podium_`.
- Every tool sets `annotations` with `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`.
- Destructive tools (`podium_apply_ordering`, `podium_unassign_stream`, `podium_backup` restore, `podium_reset_state`) take `confirm: z.literal(true)`.
- `podium_backup` and `podium_reset_state` register only when `PODIUM_MCP_ENABLE_DESTRUCTIVE=true`.
- Settings with `kind: "secret"` are never written via the server and are stripped from `effective` on read.
- Logs go to stderr only (stdio transport uses stdout for protocol).
- TDD: write the failing test first for every unit. Commit after each task.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts` | Toolchain |
| `src/config.ts` | Parse and validate env vars into `Config` |
| `src/log.ts` | Leveled stderr logger |
| `src/podium/types.ts` | Request/response types for Podium |
| `src/podium/errors.ts` | `PodiumError` |
| `src/podium/client.ts` | `PodiumClient`, one method per endpoint |
| `src/tools/result.ts` | `ok`, `fail`, `run` helpers for tool results |
| `src/tools/read.ts` | 13 read-only tools |
| `src/tools/refresh.ts` | `podium_refresh` |
| `src/tools/channels.ts` | preview, check, apply, unassign |
| `src/tools/rules.ts` | `podium_rules`, `podium_upload_rules` |
| `src/tools/groups.ts` | `podium_set_group` |
| `src/tools/ordering.ts` | `podium_set_ordering` |
| `src/tools/settings.ts` | `podium_settings` |
| `src/tools/teamarr.ts` | `podium_teamarr_sync` |
| `src/tools/dangerous.ts` | `podium_backup`, `podium_reset_state` |
| `src/server.ts` | `buildServer(client, config)` registers all tool groups |
| `src/transport/http.ts` | Express app, auth, sessions, `/healthz` |
| `src/transport/stdio.ts` | stdio startup |
| `src/index.ts` | Entrypoint |
| `scripts/smoke.ts` | Local read-tool smoke run against a real Podium |
| `test/helpers.ts` | Mock client factory and in-memory MCP client connector |
| `test/**/*.test.ts` | Vitest tests |
| `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `.env.example` | Container packaging |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml` | CI/CD |
| `README.md`, `docs/podium-api.md`, `LICENSE` | Docs |

---

### Task 1: Project scaffold and toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `.editorconfig`, `.gitattributes`
- Test: `test/smoke.test.ts` (temporary, deleted in Task 2)

**Interfaces:**
- Produces: npm scripts `build`, `typecheck`, `lint`, `test`, `start`, `smoke` used by every later task and by CI.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "podium-mcp",
  "version": "0.1.0",
  "description": "MCP server for Podium, the provider-aware stream checker and reorderer for Dispatcharr",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=22" },
  "main": "dist/index.js",
  "bin": { "podium-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/index.js",
    "smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "express": "^5.2.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.0",
    "@types/express": "^5.0.6",
    "@types/node": "^22.19.0",
    "eslint": "^9.39.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.48.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` and `tsconfig.build.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "sourceMap": true
  },
  "include": ["src", "test", "scripts", "vitest.config.ts"]
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `.gitignore`, `.editorconfig`, `.gitattributes`**

`.gitignore`:
```
node_modules/
dist/
coverage/
.env
*.tgz
```

`.editorconfig`:
```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

`.gitattributes`:
```
* text=auto eol=lf
```

- [ ] **Step 6: Write a throwaway test to prove the toolchain runs**

`test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Install and run every script**

Run: `npm install && npm run typecheck && npm run lint && npm test`
Expected: install succeeds, typecheck passes with no files emitted, lint passes, 1 test passes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript project with vitest and eslint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Config and logger

**Files:**
- Create: `src/config.ts`, `src/log.ts`
- Test: `test/config.test.ts`
- Delete: `test/smoke.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Config {
    podiumUrl: string;
    podiumToken?: string;
    podiumTimeoutMs: number;
    transport: 'http' | 'stdio';
    port: number;
    mcpAuthToken?: string;
    enableDestructive: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  }
  export function loadConfig(env: NodeJS.ProcessEnv): Config; // throws Error with readable message
  export const log: { debug(msg: string, meta?: unknown): void; info(...): void; warn(...): void; error(...): void; setLevel(level: Config['logLevel']): void };
  ```

- [ ] **Step 1: Write the failing tests**

`test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('requires PODIUM_URL', () => {
    expect(() => loadConfig({})).toThrow(/PODIUM_URL/);
  });

  it('applies defaults', () => {
    const cfg = loadConfig({ PODIUM_URL: 'http://podium.example:3000' });
    expect(cfg).toEqual({
      podiumUrl: 'http://podium.example:3000',
      podiumTimeoutMs: 30000,
      transport: 'http',
      port: 8080,
      enableDestructive: false,
      logLevel: 'info',
    });
  });

  it('strips a trailing slash from PODIUM_URL', () => {
    const cfg = loadConfig({ PODIUM_URL: 'http://podium.example:3000/' });
    expect(cfg.podiumUrl).toBe('http://podium.example:3000');
  });

  it('rejects a non-URL PODIUM_URL', () => {
    expect(() => loadConfig({ PODIUM_URL: 'not a url' })).toThrow(/PODIUM_URL/);
  });

  it('parses every optional variable', () => {
    const cfg = loadConfig({
      PODIUM_URL: 'http://podium.example:3000',
      PODIUM_TOKEN: 'abc',
      PODIUM_TIMEOUT_MS: '5000',
      MCP_TRANSPORT: 'stdio',
      MCP_PORT: '9000',
      MCP_AUTH_TOKEN: 'secret',
      PODIUM_MCP_ENABLE_DESTRUCTIVE: 'true',
      LOG_LEVEL: 'debug',
    });
    expect(cfg.podiumToken).toBe('abc');
    expect(cfg.podiumTimeoutMs).toBe(5000);
    expect(cfg.transport).toBe('stdio');
    expect(cfg.port).toBe(9000);
    expect(cfg.mcpAuthToken).toBe('secret');
    expect(cfg.enableDestructive).toBe(true);
    expect(cfg.logLevel).toBe('debug');
  });

  it('treats only "true" and "1" as enabling destructive tools', () => {
    const base = { PODIUM_URL: 'http://podium.example:3000' };
    expect(loadConfig({ ...base, PODIUM_MCP_ENABLE_DESTRUCTIVE: '1' }).enableDestructive).toBe(true);
    expect(loadConfig({ ...base, PODIUM_MCP_ENABLE_DESTRUCTIVE: 'yes' }).enableDestructive).toBe(false);
    expect(loadConfig({ ...base, PODIUM_MCP_ENABLE_DESTRUCTIVE: '' }).enableDestructive).toBe(false);
  });

  it('rejects an unknown transport', () => {
    expect(() => loadConfig({ PODIUM_URL: 'http://podium.example:3000', MCP_TRANSPORT: 'sse' })).toThrow(/MCP_TRANSPORT/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, cannot resolve `../src/config.js`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { z } from 'zod';

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const intFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().positive());

const envSchema = z.object({
  PODIUM_URL: z
    .string({ error: 'PODIUM_URL is required (base URL of your Podium instance)' })
    .url({ error: 'PODIUM_URL must be a valid URL, e.g. http://<podium-host>:<port>' })
    .transform((v) => v.replace(/\/+$/, '')),
  PODIUM_TOKEN: z.string().optional(),
  PODIUM_TIMEOUT_MS: intFromEnv(30000),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_PORT: intFromEnv(8080),
  MCP_AUTH_TOKEN: z.string().optional(),
  PODIUM_MCP_ENABLE_DESTRUCTIVE: boolFromEnv,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface Config {
  podiumUrl: string;
  podiumToken?: string;
  podiumTimeoutMs: number;
  transport: 'http' | 'stdio';
  port: number;
  mcpAuthToken?: string;
  enableDestructive: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function emptyToUndefined(v: string | undefined): string | undefined {
  return v === undefined || v === '' ? undefined : v;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const cfg: Config = {
    podiumUrl: e.PODIUM_URL,
    podiumTimeoutMs: e.PODIUM_TIMEOUT_MS,
    transport: e.MCP_TRANSPORT,
    port: e.MCP_PORT,
    enableDestructive: e.PODIUM_MCP_ENABLE_DESTRUCTIVE,
    logLevel: e.LOG_LEVEL,
  };
  const podiumToken = emptyToUndefined(e.PODIUM_TOKEN);
  if (podiumToken !== undefined) cfg.podiumToken = podiumToken;
  const mcpAuthToken = emptyToUndefined(e.MCP_AUTH_TOKEN);
  if (mcpAuthToken !== undefined) cfg.mcpAuthToken = mcpAuthToken;
  return cfg;
}
```

Note: with zod 4 the `.url()` check runs after `z.string()`; the `{ error }` option sets the message for that check. The `PODIUM_URL` issue path is `PODIUM_URL`, so the thrown message includes the variable name, which the first test asserts.

- [ ] **Step 4: Implement `src/log.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 6: Delete the scaffold test, run full checks, commit**

```bash
git rm -q test/smoke.test.ts
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add environment config loader and stderr logger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Podium error type and client request core

**Files:**
- Create: `src/podium/errors.ts`, `src/podium/types.ts`, `src/podium/client.ts`
- Test: `test/podium/client-core.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class PodiumError extends Error { status: number; method: string; path: string; body: string; }
  export interface PodiumClientOptions { baseUrl: string; token?: string; timeoutMs: number }
  export class PodiumClient {
    constructor(opts: PodiumClientOptions, fetchImpl?: typeof fetch);
    // protected core used by every endpoint method added in Tasks 4 and 5:
    protected request<T>(method: string, path: string, init?: { query?: Record<string, string | number | boolean | undefined>; json?: unknown; text?: string }): Promise<T>;
  }
  export type Json = Record<string, unknown>;
  ```

- [ ] **Step 1: Write the failing tests**

`test/podium/client-core.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { PodiumClient } from '../../src/podium/client.js';
import { PodiumError } from '../../src/podium/errors.js';

const BASE = 'http://podium.example:3000';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Subclass to reach the protected request() method in tests.
class TestClient extends PodiumClient {
  call<T>(method: string, path: string, init?: Parameters<PodiumClient['request']>[2]) {
    return this.request<T>(method, path, init);
  }
}

describe('PodiumClient core', () => {
  it('builds the URL from baseUrl and path and sends JSON headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    const out = await client.call('GET', '/api/health');
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/health`);
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it('appends only defined query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('GET', '/api/streams', { query: { q: 'espn', limit: 5, flag: true, skip: undefined } });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/api/streams?q=espn&limit=5&flag=true`);
  });

  it('sends a bearer token when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, token: 'tok', timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('GET', '/api/health');
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer tok');
  });

  it('serialises a json body with content-type application/json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('POST', '/api/refresh', { json: { scope: 'all' } });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBe('{"scope":"all"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('sends a text body with content-type text/plain', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('POST', '/api/rule-check', { text: '{"rules":[]}' });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBe('{"rules":[]}');
    expect(new Headers(init.headers).get('content-type')).toBe('text/plain');
  });

  it('returns an empty object for an empty 2xx body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    expect(await client.call('DELETE', '/api/refresh')).toEqual({});
  });

  it('throws PodiumError with status, method, path and body on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"nope"}', { status: 400 }));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    const err = await client.call('POST', '/api/apply/1', { json: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(PodiumError);
    expect(err.status).toBe(400);
    expect(err.method).toBe('POST');
    expect(err.path).toBe('/api/apply/1');
    expect(err.body).toBe('{"error":"nope"}');
    expect(err.message).toMatch(/400/);
  });

  it('throws PodiumError with status 0 on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    const err = await client.call('GET', '/api/health').catch((e) => e);
    expect(err).toBeInstanceOf(PodiumError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/fetch failed/);
  });

  it('passes an AbortSignal so requests time out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('GET', '/api/health');
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/podium/client-core.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/podium/errors.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/podium/types.ts`**

```ts
export type Json = Record<string, unknown>;

export interface HealthResponse extends Json {
  status: string;
  worker: string;
  heartbeatAgeSeconds: number;
}

export interface SettingsField extends Json {
  key: string;
  kind: string;
  label?: string;
  help?: string;
  section?: string;
  value?: unknown;
  isSet?: boolean;
  source?: string;
  defaultValue?: unknown;
}

export interface SettingsResponse extends Json {
  fields: SettingsField[];
  effective: Record<string, unknown>;
}

export type RefreshScope = 'all' | 'group';

export interface PreviewRequest {
  channelId: number;
  aliases?: string[];
  contains?: string[];
  exclude?: string[];
  providers?: string[];
}

export interface ApplyRequest {
  order: number[];
  removeUnmatched?: boolean;
  force?: boolean;
  allowAssign?: boolean;
}

export interface RulesRequest {
  aliases?: string[];
  contains?: string[];
  exclude?: string[];
  providers?: string[];
  minResolution?: string | number;
}

export interface GroupUpdateRequest {
  mode?: string;
  measureOnly?: boolean;
}

export interface GroupPatternRequest {
  pattern: string;
  mode?: string;
  measureOnly?: boolean;
}

export interface OrderingWeights {
  resolution?: number;
  bitrate?: number;
  fps?: number;
  codec?: number;
  audio?: number;
  hdr?: number;
  preferH265?: boolean;
  hdrPreference?: string;
  hevcBitrateFactor?: number;
  uhdBitrateKbps?: number;
}

export interface OrderingRequest {
  mode?: string;
  providerPreference?: string[];
  weights?: OrderingWeights;
}

export interface QualityProfileQuery {
  minSamples: number;
  eventOnly?: boolean;
  include?: string;
  exclude?: string;
}
```

- [ ] **Step 5: Implement the core of `src/podium/client.ts`**

```ts
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
        body,
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/podium/client-core.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add PodiumClient request core and PodiumError

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Client read methods

**Files:**
- Modify: `src/podium/client.ts`
- Test: `test/podium/client-reads.test.ts`

**Interfaces:**
- Produces on `PodiumClient`:
  ```ts
  health(): Promise<HealthResponse>
  stats(): Promise<Json>
  progress(): Promise<Json>
  dead(): Promise<Json>
  state(refresh?: boolean): Promise<Json>
  searchStreams(query: string): Promise<Json>
  streamGroups(): Promise<Json>
  getOrdering(): Promise<Json>
  qualityProfile(q: QualityProfileQuery): Promise<Json>
  ruleStatus(): Promise<Json>
  nameNoise(query?: string): Promise<Json>
  getSettings(): Promise<SettingsResponse>
  backup(): Promise<Json>
  teamarrStatus(): Promise<Json>
  ```

- [ ] **Step 1: Write the failing tests**

`test/podium/client-reads.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { PodiumClient } from '../../src/podium/client.js';

const BASE = 'http://podium.example:3000';

function make() {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  const client = new PodiumClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
  const calledWith = () => {
    const [url, init] = fetchMock.mock.calls[0]!;
    return { url: String(url).replace(BASE, ''), method: init.method as string };
  };
  return { client, calledWith };
}

describe('PodiumClient reads', () => {
  const cases: Array<[string, (c: PodiumClient) => Promise<unknown>, string]> = [
    ['health', (c) => c.health(), '/api/health'],
    ['stats', (c) => c.stats(), '/api/stats'],
    ['progress', (c) => c.progress(), '/api/progress'],
    ['dead', (c) => c.dead(), '/api/dead'],
    ['state', (c) => c.state(), '/api/state'],
    ['state refresh', (c) => c.state(true), '/api/state?refresh=1'],
    ['searchStreams', (c) => c.searchStreams('espn'), '/api/streams?q=espn'],
    ['streamGroups', (c) => c.streamGroups(), '/api/stream-groups'],
    ['getOrdering', (c) => c.getOrdering(), '/api/ordering'],
    ['qualityProfile min', (c) => c.qualityProfile({ minSamples: 3 }), '/api/quality-profile?minSamples=3'],
    [
      'qualityProfile full',
      (c) => c.qualityProfile({ minSamples: 3, eventOnly: false, include: 'a', exclude: 'b' }),
      '/api/quality-profile?minSamples=3&eventOnly=0&include=a&exclude=b',
    ],
    ['ruleStatus', (c) => c.ruleStatus(), '/api/rule-check'],
    ['nameNoise', (c) => c.nameNoise(), '/api/name-noise'],
    ['nameNoise q', (c) => c.nameNoise('hd'), '/api/name-noise?q=hd'],
    ['getSettings', (c) => c.getSettings(), '/api/settings'],
    ['backup', (c) => c.backup(), '/api/backup'],
    ['teamarrStatus', (c) => c.teamarrStatus(), '/api/teamarr-sync'],
  ];

  for (const [name, fn, expectedUrl] of cases) {
    it(`${name} GETs ${expectedUrl}`, async () => {
      const { client, calledWith } = make();
      await fn(client);
      expect(calledWith()).toEqual({ url: expectedUrl, method: 'GET' });
    });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/podium/client-reads.test.ts`
Expected: FAIL, `c.health is not a function`.

- [ ] **Step 3: Add the read methods to `PodiumClient`**

Add the import at the top of `src/podium/client.ts`:
```ts
import type { HealthResponse, Json, QualityProfileQuery, SettingsResponse } from './types.js';
```

Add inside the class, after `request`:
```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/podium/client-reads.test.ts`
Expected: 17 tests PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add PodiumClient read endpoints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Client mutating methods

**Files:**
- Modify: `src/podium/client.ts`
- Test: `test/podium/client-writes.test.ts`

**Interfaces:**
- Produces on `PodiumClient`:
  ```ts
  queueRefresh(scope: RefreshScope, groupId?: number): Promise<Json>
  cancelRefresh(scope: RefreshScope, groupId?: number): Promise<Json>
  preview(body: PreviewRequest): Promise<Json>
  checkChannel(channelId: number, force?: boolean): Promise<Json>
  applyOrdering(channelId: number, body: ApplyRequest): Promise<Json>
  unassignStream(channelId: number, streamId: number): Promise<Json>
  saveRules(channelId: number, body: RulesRequest): Promise<Json>
  clearRulePatterns(channelId: number): Promise<Json>
  setGroup(groupId: number, body: GroupUpdateRequest): Promise<Json>
  setGroupPattern(body: GroupPatternRequest): Promise<Json>
  setOrdering(body: OrderingRequest): Promise<Json>
  uploadRules(rulesText: string): Promise<Json>
  testSettings(values: Record<string, unknown>): Promise<Json>
  saveSettings(values: Record<string, unknown>): Promise<Json>
  teamarrSync(dryRun: boolean): Promise<Json>
  teamarrSyncTest(): Promise<Json>
  restoreBackup(backup: unknown): Promise<Json>
  resetState(): Promise<Json>
  ```

- [ ] **Step 1: Write the failing tests**

`test/podium/client-writes.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { PodiumClient } from '../../src/podium/client.js';

const BASE = 'http://podium.example:3000';

function make() {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  const client = new PodiumClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
  const calledWith = () => {
    const [url, init] = fetchMock.mock.calls[0]!;
    return {
      url: String(url).replace(BASE, ''),
      method: init.method as string,
      body: init.body as string | undefined,
      contentType: new Headers(init.headers).get('content-type'),
    };
  };
  return { client, calledWith };
}

describe('PodiumClient writes', () => {
  it('queueRefresh all', async () => {
    const { client, calledWith } = make();
    await client.queueRefresh('all');
    expect(calledWith()).toMatchObject({ url: '/api/refresh', method: 'POST', body: '{"scope":"all"}' });
  });

  it('queueRefresh group', async () => {
    const { client, calledWith } = make();
    await client.queueRefresh('group', 7);
    expect(calledWith()).toMatchObject({ url: '/api/refresh', method: 'POST', body: '{"scope":"group","groupId":7}' });
  });

  it('cancelRefresh all', async () => {
    const { client, calledWith } = make();
    await client.cancelRefresh('all');
    expect(calledWith()).toMatchObject({ url: '/api/refresh?scope=all', method: 'DELETE', body: undefined });
  });

  it('cancelRefresh group', async () => {
    const { client, calledWith } = make();
    await client.cancelRefresh('group', 7);
    expect(calledWith()).toMatchObject({ url: '/api/refresh?scope=group&groupId=7', method: 'DELETE' });
  });

  it('preview', async () => {
    const { client, calledWith } = make();
    await client.preview({ channelId: 3, aliases: ['a'] });
    expect(calledWith()).toMatchObject({ url: '/api/preview', method: 'POST', body: '{"channelId":3,"aliases":["a"]}' });
  });

  it('checkChannel without force sends empty object body', async () => {
    const { client, calledWith } = make();
    await client.checkChannel(3);
    expect(calledWith()).toMatchObject({ url: '/api/check/3', method: 'POST', body: '{}' });
  });

  it('checkChannel with force', async () => {
    const { client, calledWith } = make();
    await client.checkChannel(3, true);
    expect(calledWith()).toMatchObject({ url: '/api/check/3?force=true', method: 'POST' });
  });

  it('applyOrdering', async () => {
    const { client, calledWith } = make();
    await client.applyOrdering(3, { order: [9, 8], removeUnmatched: false, force: true, allowAssign: false });
    expect(calledWith()).toMatchObject({
      url: '/api/apply/3',
      method: 'POST',
      body: '{"order":[9,8],"removeUnmatched":false,"force":true,"allowAssign":false}',
    });
  });

  it('unassignStream', async () => {
    const { client, calledWith } = make();
    await client.unassignStream(3, 42);
    expect(calledWith()).toMatchObject({ url: '/api/unassign/3', method: 'POST', body: '{"streamId":42}' });
  });

  it('saveRules', async () => {
    const { client, calledWith } = make();
    await client.saveRules(3, { aliases: ['x'], minResolution: '720p' });
    expect(calledWith()).toMatchObject({ url: '/api/rules/3', method: 'PUT', body: '{"aliases":["x"],"minResolution":"720p"}' });
  });

  it('clearRulePatterns', async () => {
    const { client, calledWith } = make();
    await client.clearRulePatterns(3);
    expect(calledWith()).toMatchObject({ url: '/api/rules/3/patterns', method: 'DELETE' });
  });

  it('setGroup', async () => {
    const { client, calledWith } = make();
    await client.setGroup(5, { mode: 'worker', measureOnly: true });
    expect(calledWith()).toMatchObject({ url: '/api/groups/5', method: 'PUT', body: '{"mode":"worker","measureOnly":true}' });
  });

  it('setGroupPattern', async () => {
    const { client, calledWith } = make();
    await client.setGroupPattern({ pattern: 'Sports*', mode: 'measure', measureOnly: false });
    expect(calledWith()).toMatchObject({
      url: '/api/group-patterns',
      method: 'PUT',
      body: '{"pattern":"Sports*","mode":"measure","measureOnly":false}',
    });
  });

  it('setOrdering', async () => {
    const { client, calledWith } = make();
    await client.setOrdering({ mode: 'quality', weights: { fps: 0.5 } });
    expect(calledWith()).toMatchObject({ url: '/api/ordering', method: 'PUT', body: '{"mode":"quality","weights":{"fps":0.5}}' });
  });

  it('uploadRules sends text/plain', async () => {
    const { client, calledWith } = make();
    await client.uploadRules('{"rules":[]}');
    expect(calledWith()).toMatchObject({ url: '/api/rule-check', method: 'POST', body: '{"rules":[]}', contentType: 'text/plain' });
  });

  it('testSettings', async () => {
    const { client, calledWith } = make();
    await client.testSettings({ A: '1' });
    expect(calledWith()).toMatchObject({ url: '/api/settings/test', method: 'POST', body: '{"A":"1"}' });
  });

  it('saveSettings', async () => {
    const { client, calledWith } = make();
    await client.saveSettings({ A: '1' });
    expect(calledWith()).toMatchObject({ url: '/api/settings', method: 'PUT', body: '{"A":"1"}' });
  });

  it('teamarrSync dryRun', async () => {
    const { client, calledWith } = make();
    await client.teamarrSync(true);
    expect(calledWith()).toMatchObject({ url: '/api/teamarr-sync?dryRun=1', method: 'POST' });
  });

  it('teamarrSync live', async () => {
    const { client, calledWith } = make();
    await client.teamarrSync(false);
    expect(calledWith()).toMatchObject({ url: '/api/teamarr-sync', method: 'POST' });
  });

  it('teamarrSyncTest', async () => {
    const { client, calledWith } = make();
    await client.teamarrSyncTest();
    expect(calledWith()).toMatchObject({ url: '/api/teamarr-sync/test', method: 'POST' });
  });

  it('restoreBackup', async () => {
    const { client, calledWith } = make();
    await client.restoreBackup({ kind: 'podium-backup', version: 1 });
    expect(calledWith()).toMatchObject({ url: '/api/backup', method: 'POST', body: '{"kind":"podium-backup","version":1}' });
  });

  it('resetState', async () => {
    const { client, calledWith } = make();
    await client.resetState();
    expect(calledWith()).toMatchObject({ url: '/api/state/reset', method: 'POST' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/podium/client-writes.test.ts`
Expected: FAIL, methods not functions.

- [ ] **Step 3: Add the write methods to `PodiumClient`**

Extend the type import:
```ts
import type {
  ApplyRequest,
  GroupPatternRequest,
  GroupUpdateRequest,
  HealthResponse,
  Json,
  OrderingRequest,
  PreviewRequest,
  QualityProfileQuery,
  RefreshScope,
  RulesRequest,
  SettingsResponse,
} from './types.js';
```

Add inside the class after the reads:
```ts
  // ---- writes ----
  queueRefresh(scope: RefreshScope, groupId?: number): Promise<Json> {
    const json: Json = { scope };
    if (scope === 'group') json.groupId = groupId;
    return this.request('POST', '/api/refresh', { json });
  }
  cancelRefresh(scope: RefreshScope, groupId?: number): Promise<Json> {
    return this.request('DELETE', '/api/refresh', {
      query: { scope, groupId: scope === 'group' ? groupId : undefined },
    });
  }
  preview(body: PreviewRequest): Promise<Json> {
    return this.request('POST', '/api/preview', { json: body });
  }
  checkChannel(channelId: number, force = false): Promise<Json> {
    return this.request('POST', `/api/check/${channelId}`, {
      query: { force: force ? true : undefined },
      json: {},
    });
  }
  applyOrdering(channelId: number, body: ApplyRequest): Promise<Json> {
    return this.request('POST', `/api/apply/${channelId}`, { json: body });
  }
  unassignStream(channelId: number, streamId: number): Promise<Json> {
    return this.request('POST', `/api/unassign/${channelId}`, { json: { streamId } });
  }
  saveRules(channelId: number, body: RulesRequest): Promise<Json> {
    return this.request('PUT', `/api/rules/${channelId}`, { json: body });
  }
  clearRulePatterns(channelId: number): Promise<Json> {
    return this.request('DELETE', `/api/rules/${channelId}/patterns`);
  }
  setGroup(groupId: number, body: GroupUpdateRequest): Promise<Json> {
    return this.request('PUT', `/api/groups/${groupId}`, { json: body });
  }
  setGroupPattern(body: GroupPatternRequest): Promise<Json> {
    return this.request('PUT', '/api/group-patterns', { json: body });
  }
  setOrdering(body: OrderingRequest): Promise<Json> {
    return this.request('PUT', '/api/ordering', { json: body });
  }
  uploadRules(rulesText: string): Promise<Json> {
    return this.request('POST', '/api/rule-check', { text: rulesText });
  }
  testSettings(values: Record<string, unknown>): Promise<Json> {
    return this.request('POST', '/api/settings/test', { json: values });
  }
  saveSettings(values: Record<string, unknown>): Promise<Json> {
    return this.request('PUT', '/api/settings', { json: values });
  }
  teamarrSync(dryRun: boolean): Promise<Json> {
    return this.request('POST', '/api/teamarr-sync', { query: { dryRun: dryRun ? 1 : undefined } });
  }
  teamarrSyncTest(): Promise<Json> {
    return this.request('POST', '/api/teamarr-sync/test');
  }
  restoreBackup(backup: unknown): Promise<Json> {
    return this.request('POST', '/api/backup', { json: backup });
  }
  resetState(): Promise<Json> {
    return this.request('POST', '/api/state/reset');
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/podium`
Expected: all client tests PASS (9 + 17 + 22).

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add -A
git commit -m "feat: add PodiumClient mutating endpoints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Tool result helpers and test harness

**Files:**
- Create: `src/tools/result.ts`, `src/server.ts` (minimal, extended in later tasks), `test/helpers.ts`
- Test: `test/tools/result.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/tools/result.ts
  export function ok(data: unknown, summary: string): CallToolResult;
  export function fail(message: string): CallToolResult;
  export function run(summary: string | ((data: unknown) => string), fn: () => Promise<unknown>): Promise<CallToolResult>;

  // src/server.ts
  export interface ToolContext { client: PodiumClient; config: Config }
  export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;
  export function buildServer(client: PodiumClient, config: Config): McpServer;

  // test/helpers.ts
  export function mockClient(overrides?: Partial<Record<keyof PodiumClient, unknown>>): PodiumClient & Record<string, Mock>;
  export function testConfig(overrides?: Partial<Config>): Config;
  export async function connect(client: PodiumClient, config?: Partial<Config>): Promise<Client>;
  export function textOf(result: CallToolResult): string;
  ```

- [ ] **Step 1: Write the failing test for result helpers**

`test/tools/result.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fail, ok, run } from '../../src/tools/result.js';
import { PodiumError } from '../../src/podium/errors.js';

describe('result helpers', () => {
  it('ok returns summary text, JSON text and structuredContent', () => {
    const r = ok({ a: 1 }, 'Summary');
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.content).toHaveLength(1);
    const text = (r.content[0] as { text: string }).text;
    expect(text.startsWith('Summary\n')).toBe(true);
    expect(text).toContain('"a": 1');
  });

  it('ok wraps non-object data in { result }', () => {
    expect(ok([1, 2], 'x').structuredContent).toEqual({ result: [1, 2] });
    expect(ok('s', 'x').structuredContent).toEqual({ result: 's' });
  });

  it('fail sets isError', () => {
    const r = fail('bad');
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toBe('bad');
  });

  it('run converts PodiumError into an isError result', async () => {
    const r = await run('never', async () => {
      throw new PodiumError({ status: 404, method: 'GET', path: '/api/x', body: 'missing' });
    });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/GET \/api\/x/);
    expect((r.content[0] as { text: string }).text).toMatch(/404/);
  });

  it('run converts other errors into an isError result', async () => {
    const r = await run('never', async () => {
      throw new Error('boom');
    });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/boom/);
  });

  it('run supports a summary function receiving the data', async () => {
    const r = await run((d) => `got ${(d as { n: number }).n}`, async () => ({ n: 3 }));
    expect((r.content[0] as { text: string }).text.startsWith('got 3\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tools/result.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/tools/result.ts`**

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PodiumError } from '../podium/errors.js';

function asStructured(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data };
}

export function ok(data: unknown, summary: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: asStructured(data),
  };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export async function run(
  summary: string | ((data: unknown) => string),
  fn: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const data = await fn();
    return ok(data, typeof summary === 'function' ? summary(data) : summary);
  } catch (err) {
    if (err instanceof PodiumError) return fail(err.message);
    return fail(err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tools/result.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Create the minimal `src/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import type { PodiumClient } from './podium/client.js';

export interface ToolContext {
  client: PodiumClient;
  config: Config;
}

export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

// Tool groups are appended here by later tasks.
const registrars: ToolRegistrar[] = [];

export const SERVER_INFO = { name: 'podium-mcp', version: '0.1.0' } as const;

export function buildServer(client: PodiumClient, config: Config): McpServer {
  const server = new McpServer(SERVER_INFO);
  const ctx: ToolContext = { client, config };
  for (const register of registrars) register(server, ctx);
  return server;
}
```

- [ ] **Step 6: Create `test/helpers.ts`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { vi, type Mock } from 'vitest';
import type { Config } from '../src/config.js';
import type { PodiumClient } from '../src/podium/client.js';
import { buildServer } from '../src/server.js';

const METHODS = [
  'health', 'stats', 'progress', 'dead', 'state', 'searchStreams', 'streamGroups', 'getOrdering',
  'qualityProfile', 'ruleStatus', 'nameNoise', 'getSettings', 'backup', 'teamarrStatus',
  'queueRefresh', 'cancelRefresh', 'preview', 'checkChannel', 'applyOrdering', 'unassignStream',
  'saveRules', 'clearRulePatterns', 'setGroup', 'setGroupPattern', 'setOrdering', 'uploadRules',
  'testSettings', 'saveSettings', 'teamarrSync', 'teamarrSyncTest', 'restoreBackup', 'resetState',
] as const;

export type MockedClient = PodiumClient & Record<(typeof METHODS)[number], Mock>;

export function mockClient(overrides: Partial<Record<(typeof METHODS)[number], unknown>> = {}): MockedClient {
  const obj: Record<string, unknown> = {};
  for (const m of METHODS) {
    obj[m] = vi.fn().mockResolvedValue({ ok: true, via: m });
  }
  for (const [k, v] of Object.entries(overrides)) {
    obj[k] = typeof v === 'function' ? v : vi.fn().mockResolvedValue(v);
  }
  return obj as unknown as MockedClient;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    podiumUrl: 'http://podium.example:3000',
    podiumTimeoutMs: 1000,
    transport: 'http',
    port: 0,
    enableDestructive: false,
    logLevel: 'error',
    ...overrides,
  };
}

export async function connect(client: PodiumClient, config: Partial<Config> = {}): Promise<Client> {
  const server = buildServer(client, testConfig(config));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'test-client', version: '0.0.0' });
  await mcp.connect(clientTransport);
  return mcp;
}

export function textOf(result: unknown): string {
  const r = result as CallToolResult;
  return r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}
```

- [ ] **Step 7: Write a server test proving the harness connects**

`test/server.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connect, mockClient } from './helpers.js';

describe('buildServer', () => {
  it('connects and lists tools', async () => {
    const mcp = await connect(mockClient());
    const { tools } = await mcp.listTools();
    expect(Array.isArray(tools)).toBe(true);
    await mcp.close();
  });
});
```

- [ ] **Step 8: Run all tests, typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

```bash
git add -A
git commit -m "feat: add tool result helpers, server skeleton and test harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Read-only tools

**Files:**
- Create: `src/tools/read.ts`
- Modify: `src/server.ts` (add registrar)
- Test: `test/tools/read.test.ts`

**Interfaces:**
- Consumes: `PodiumClient` read methods (Task 4), `run` (Task 6), `ToolRegistrar` (Task 6).
- Produces: `export const registerReadTools: ToolRegistrar` and the 13 tool names in the spec §4.1.

- [ ] **Step 1: Write the failing tests**

`test/tools/read.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connect, mockClient, textOf } from '../helpers.js';

const READ_TOOLS = [
  'podium_health', 'podium_stats', 'podium_progress', 'podium_dead', 'podium_state',
  'podium_search_streams', 'podium_stream_groups', 'podium_get_ordering', 'podium_quality_profile',
  'podium_rule_status', 'podium_name_noise', 'podium_get_settings', 'podium_teamarr_status',
];

describe('read tools', () => {
  it('registers every read tool with readOnlyHint', async () => {
    const mcp = await connect(mockClient());
    const { tools } = await mcp.listTools();
    for (const name of READ_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.annotations?.readOnlyHint, name).toBe(true);
      expect(t!.annotations?.destructiveHint, name).toBe(false);
      expect(t!.annotations?.openWorldHint, name).toBe(false);
    }
    await mcp.close();
  });

  it('podium_health calls client.health and returns its data', async () => {
    const client = mockClient({ health: { status: 'ok', worker: 'active', heartbeatAgeSeconds: 2 } });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_health', arguments: {} });
    expect(client.health).toHaveBeenCalledOnce();
    expect(r.structuredContent).toEqual({ status: 'ok', worker: 'active', heartbeatAgeSeconds: 2 });
    expect(textOf(r)).toMatch(/ok/);
    await mcp.close();
  });

  it('podium_state passes refresh flag', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_state', arguments: {} });
    expect(client.state).toHaveBeenLastCalledWith(false);
    await mcp.callTool({ name: 'podium_state', arguments: { refresh: true } });
    expect(client.state).toHaveBeenLastCalledWith(true);
    await mcp.close();
  });

  it('podium_search_streams rejects queries under 2 chars', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_search_streams', arguments: { query: 'a' } });
    expect(r.isError).toBe(true);
    expect(client.searchStreams).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_search_streams', arguments: { query: 'ab' } });
    expect(client.searchStreams).toHaveBeenCalledWith('ab');
    await mcp.close();
  });

  it('podium_quality_profile forwards all params', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({
      name: 'podium_quality_profile',
      arguments: { minSamples: 4, eventOnly: true, include: 'x', exclude: 'y' },
    });
    expect(client.qualityProfile).toHaveBeenCalledWith({ minSamples: 4, eventOnly: true, include: 'x', exclude: 'y' });
    await mcp.close();
  });

  it('podium_name_noise forwards optional query', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_name_noise', arguments: {} });
    expect(client.nameNoise).toHaveBeenLastCalledWith(undefined);
    await mcp.callTool({ name: 'podium_name_noise', arguments: { query: 'hd' } });
    expect(client.nameNoise).toHaveBeenLastCalledWith('hd');
    await mcp.close();
  });

  it('podium_get_settings strips secret keys from effective', async () => {
    const client = mockClient({
      getSettings: {
        fields: [
          { key: 'DISPATCHARR_URL', kind: 'string', value: 'http://x' },
          { key: 'DISPATCHARR_API_KEY', kind: 'secret', value: '••••' },
        ],
        effective: { DISPATCHARR_URL: 'http://x', DISPATCHARR_API_KEY: 'realsecret' },
      },
    });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_get_settings', arguments: {} });
    const sc = r.structuredContent as { effective: Record<string, unknown>; fields: unknown[] };
    expect(sc.effective).toEqual({ DISPATCHARR_URL: 'http://x' });
    expect(sc.fields).toHaveLength(2);
    expect(textOf(r)).not.toContain('realsecret');
    await mcp.close();
  });

  it('returns isError when Podium fails', async () => {
    const { PodiumError } = await import('../../src/podium/errors.js');
    const client = mockClient({
      stats: () => Promise.reject(new PodiumError({ status: 503, method: 'GET', path: '/api/stats', body: 'down' })),
    });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_stats', arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/503/);
    await mcp.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/tools/read.test.ts`
Expected: FAIL, tools not found.

- [ ] **Step 3: Implement `src/tools/read.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import type { SettingsResponse } from '../podium/types.js';
import { run } from './result.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function stripSecrets(settings: SettingsResponse): SettingsResponse {
  const secretKeys = new Set(settings.fields.filter((f) => f.kind === 'secret').map((f) => f.key));
  const effective: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings.effective ?? {})) {
    if (!secretKeys.has(k)) effective[k] = v;
  }
  return { ...settings, effective };
}

export const registerReadTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_health',
    { title: 'Podium health', description: 'Health of the Podium service and its background worker.', inputSchema: {}, annotations: READ },
    () => run('Podium health', () => client.health()),
  );

  server.registerTool(
    'podium_stats',
    {
      title: 'Podium stats',
      description: 'Worker status, stream state counts (alive/dead/black/low bitrate/unmeasured), primary channel health, per-provider breakdown and data freshness.',
      inputSchema: {},
      annotations: READ,
    },
    () => run('Podium stats', () => client.stats()),
  );

  server.registerTool(
    'podium_progress',
    { title: 'Checker progress', description: 'Current or last checker run: phase, probed/dead/reordered counts, held-back reasons, next run time.', inputSchema: {}, annotations: READ },
    () => run('Checker progress', () => client.progress()),
  );

  server.registerTool(
    'podium_dead',
    { title: 'Dead streams', description: 'Dead, black and orphan streams grouped by provider and channel.', inputSchema: {}, annotations: READ },
    () => run('Dead streams', () => client.dead()),
  );

  server.registerTool(
    'podium_state',
    {
      title: 'Channel and group state',
      description:
        'Main channel/group view: groups, patterns and providers. Set refresh=true to force Podium to refetch from Dispatcharr first (slower, and counts against Dispatcharr rate limits).',
      inputSchema: { refresh: z.boolean().default(false).describe('Force a refetch from Dispatcharr before returning') },
      annotations: { ...READ, idempotentHint: false },
    },
    ({ refresh }) => run(refresh ? 'Channel state (refreshed from Dispatcharr)' : 'Channel state', () => client.state(refresh)),
  );

  server.registerTool(
    'podium_search_streams',
    {
      title: 'Search streams',
      description: 'Search streams by name. Query must be at least 2 characters.',
      inputSchema: { query: z.string().min(2).describe('Text to search for (min 2 chars)') },
      annotations: READ,
    },
    ({ query }) => run(`Streams matching "${query}"`, () => client.searchStreams(query)),
  );

  server.registerTool(
    'podium_stream_groups',
    { title: 'Stream groups', description: 'All stream groups with stream counts, claimed/excluded status and totals.', inputSchema: {}, annotations: READ },
    () => run('Stream groups', () => client.streamGroups()),
  );

  server.registerTool(
    'podium_get_ordering',
    { title: 'Get ordering config', description: 'Current ordering mode, provider preference, quality weights and defaults.', inputSchema: {}, annotations: READ },
    () => run('Ordering configuration', () => client.getOrdering()),
  );

  server.registerTool(
    'podium_quality_profile',
    {
      title: 'Quality profile',
      description: 'Quality profile data used for rule generation.',
      inputSchema: {
        minSamples: z.number().int().min(1).describe('Minimum measured samples per entry'),
        eventOnly: z.boolean().optional().describe('Restrict to event channels'),
        include: z.string().optional().describe('Include filter'),
        exclude: z.string().optional().describe('Exclude filter'),
      },
      annotations: READ,
    },
    (args) => run('Quality profile', () => client.qualityProfile(args)),
  );

  server.registerTool(
    'podium_rule_status',
    { title: 'Rule status', description: 'Status of uploaded stream-ordering rules: upload time, rule count, history and latest results.', inputSchema: {}, annotations: READ },
    () => run('Rule status', () => client.ruleStatus()),
  );

  server.registerTool(
    'podium_name_noise',
    {
      title: 'Name noise',
      description: 'Name-noise detector output: strip tokens, entries and candidates. Optional query narrows results.',
      inputSchema: { query: z.string().optional().describe('Optional filter text') },
      annotations: READ,
    },
    ({ query }) => run('Name noise', () => client.nameNoise(query)),
  );

  server.registerTool(
    'podium_get_settings',
    {
      title: 'Get settings',
      description: 'Podium settings fields with current values. Secret values are masked and secret keys are removed from the effective map.',
      inputSchema: {},
      annotations: READ,
    },
    () => run('Settings', async () => stripSecrets(await client.getSettings())),
  );

  server.registerTool(
    'podium_teamarr_status',
    { title: 'Teamarr sync status', description: 'Teamarr rules sync configuration and last/next run.', inputSchema: {}, annotations: READ },
    () => run('Teamarr sync status', () => client.teamarrStatus()),
  );
};
```

- [ ] **Step 4: Register in `src/server.ts`**

Replace the registrars block:
```ts
import { registerReadTools } from './tools/read.js';

const registrars: ToolRegistrar[] = [registerReadTools];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/tools/read.test.ts`
Expected: 8 tests PASS. If the SDK rejects an empty `inputSchema: {}`, replace it with `inputSchema: undefined` and re-run.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add read-only Podium tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Refresh and channel action tools

**Files:**
- Create: `src/tools/refresh.ts`, `src/tools/channels.ts`
- Modify: `src/server.ts`
- Test: `test/tools/refresh.test.ts`, `test/tools/channels.test.ts`

**Interfaces:**
- Consumes: client write methods (Task 5), `run`/`fail` (Task 6).
- Produces: `registerRefreshTools`, `registerChannelTools`; tools `podium_refresh`, `podium_preview_channel`, `podium_check_channel`, `podium_apply_ordering`, `podium_unassign_stream`.

- [ ] **Step 1: Write the failing tests**

`test/tools/refresh.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connect, mockClient } from '../helpers.js';

describe('podium_refresh', () => {
  it('is registered as a non-read-only, non-destructive tool', async () => {
    const mcp = await connect(mockClient());
    const t = (await mcp.listTools()).tools.find((x) => x.name === 'podium_refresh');
    expect(t?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    await mcp.close();
  });

  it('queues an all-scope refresh', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_refresh', arguments: { action: 'queue', scope: 'all' } });
    expect(r.isError).toBeUndefined();
    expect(client.queueRefresh).toHaveBeenCalledWith('all', undefined);
    await mcp.close();
  });

  it('cancels a group refresh', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_refresh', arguments: { action: 'cancel', scope: 'group', groupId: 4 } });
    expect(client.cancelRefresh).toHaveBeenCalledWith('group', 4);
    await mcp.close();
  });

  it('rejects scope=group without groupId', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_refresh', arguments: { action: 'queue', scope: 'group' } });
    expect(r.isError).toBe(true);
    expect(client.queueRefresh).not.toHaveBeenCalled();
    await mcp.close();
  });
});
```

`test/tools/channels.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connect, mockClient, textOf } from '../helpers.js';

describe('channel tools', () => {
  it('annotations are correct', async () => {
    const mcp = await connect(mockClient());
    const tools = (await mcp.listTools()).tools;
    const a = (n: string) => tools.find((t) => t.name === n)?.annotations;
    expect(a('podium_preview_channel')).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(a('podium_check_channel')).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(a('podium_apply_ordering')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(a('podium_unassign_stream')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await mcp.close();
  });

  it('podium_preview_channel forwards the body', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_preview_channel', arguments: { channelId: 3, aliases: ['a'], providers: ['p'] } });
    expect(client.preview).toHaveBeenCalledWith({ channelId: 3, aliases: ['a'], contains: [], exclude: [], providers: ['p'] });
    await mcp.close();
  });

  it('podium_check_channel forwards force', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_check_channel', arguments: { channelId: 3 } });
    expect(client.checkChannel).toHaveBeenLastCalledWith(3, false);
    await mcp.callTool({ name: 'podium_check_channel', arguments: { channelId: 3, force: true } });
    expect(client.checkChannel).toHaveBeenLastCalledWith(3, true);
    await mcp.close();
  });

  it('podium_apply_ordering requires confirm: true', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r1 = await mcp.callTool({ name: 'podium_apply_ordering', arguments: { channelId: 3, order: [1, 2] } });
    expect(r1.isError).toBe(true);
    expect(textOf(r1)).toMatch(/confirm/i);
    const r2 = await mcp.callTool({ name: 'podium_apply_ordering', arguments: { channelId: 3, order: [1, 2], confirm: false } });
    expect(r2.isError).toBe(true);
    expect(client.applyOrdering).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_apply_ordering', arguments: { channelId: 3, order: [1, 2], confirm: true, force: true } });
    expect(client.applyOrdering).toHaveBeenCalledWith(3, { order: [1, 2], removeUnmatched: false, force: true, allowAssign: false });
    await mcp.close();
  });

  it('podium_unassign_stream requires confirm: true', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_unassign_stream', arguments: { channelId: 3, streamId: 9 } });
    expect(r.isError).toBe(true);
    expect(client.unassignStream).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_unassign_stream', arguments: { channelId: 3, streamId: 9, confirm: true } });
    expect(client.unassignStream).toHaveBeenCalledWith(3, 9);
    await mcp.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/tools/refresh.test.ts test/tools/channels.test.ts`
Expected: FAIL, tools not found.

- [ ] **Step 3: Add a shared `confirm` schema to `src/tools/result.ts`**

Append:
```ts
import { z } from 'zod';

export const CONFIRM_DESCRIPTION =
  'Must be exactly true. This action changes live state. Ask the user for explicit confirmation before calling with confirm=true.';

export const confirmSchema = z.literal(true, { error: 'confirm must be exactly true' }).describe(CONFIRM_DESCRIPTION);
```

Move the `import { z } from 'zod';` line to the top of the file with the other imports.

- [ ] **Step 4: Implement `src/tools/refresh.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

export const registerRefreshTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_refresh',
    {
      title: 'Queue or cancel a check run',
      description:
        'Queue a checker run (action=queue) or cancel a queued run (action=cancel) for all groups or one group. Queuing triggers stream probing against providers.',
      inputSchema: {
        action: z.enum(['queue', 'cancel']),
        scope: z.enum(['all', 'group']),
        groupId: z.number().int().optional().describe('Required when scope=group'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action, scope, groupId }) => {
      if (scope === 'group' && groupId === undefined) return fail('groupId is required when scope is "group"');
      if (action === 'queue') {
        return run(`Queued ${scope} refresh`, () => client.queueRefresh(scope, groupId));
      }
      return run(`Cancelled ${scope} refresh`, () => client.cancelRefresh(scope, groupId));
    },
  );
};
```

- [ ] **Step 5: Implement `src/tools/channels.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { confirmSchema, run } from './result.js';

const ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...ACTION, destructiveHint: true } as const;

export const registerChannelTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_preview_channel',
    {
      title: 'Preview channel matching',
      description: 'Dry-run stream matching for a channel with the given rules. Changes nothing.',
      inputSchema: {
        channelId: z.number().int(),
        aliases: z.array(z.string()).default([]),
        contains: z.array(z.string()).default([]),
        exclude: z.array(z.string()).default([]),
        providers: z.array(z.string()).default([]),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) => run(`Preview for channel ${args.channelId}`, () => client.preview(args)),
  );

  server.registerTool(
    'podium_check_channel',
    {
      title: 'Check channel streams',
      description: 'Probe every stream on one channel now. Returns probed/dead counts and whether an apply is allowed. Does not modify Dispatcharr.',
      inputSchema: {
        channelId: z.number().int(),
        force: z.boolean().default(false).describe('Re-probe even if recently measured'),
      },
      annotations: ACTION,
    },
    ({ channelId, force }) => run(`Checked channel ${channelId}`, () => client.checkChannel(channelId, force)),
  );

  server.registerTool(
    'podium_apply_ordering',
    {
      title: 'Apply stream ordering',
      description:
        'Apply a stream order to a channel in Dispatcharr. MUTATES live channel state. Use podium_check_channel first; pass force=true only if the check said allowed=false and the user accepts that.',
      inputSchema: {
        channelId: z.number().int(),
        order: z.array(z.number().int()).min(1).describe('Stream IDs in the desired order'),
        removeUnmatched: z.boolean().default(false),
        force: z.boolean().default(false),
        allowAssign: z.boolean().default(false),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    ({ channelId, order, removeUnmatched, force, allowAssign }) =>
      run(`Applied ordering to channel ${channelId}`, () =>
        client.applyOrdering(channelId, { order, removeUnmatched, force, allowAssign }),
      ),
  );

  server.registerTool(
    'podium_unassign_stream',
    {
      title: 'Unassign stream from channel',
      description: 'Remove one stream from a channel in Dispatcharr. MUTATES live channel state.',
      inputSchema: {
        channelId: z.number().int(),
        streamId: z.number().int(),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    ({ channelId, streamId }) => run(`Unassigned stream ${streamId} from channel ${channelId}`, () => client.unassignStream(channelId, streamId)),
  );
};
```

- [ ] **Step 6: Register both in `src/server.ts`**

```ts
import { registerChannelTools } from './tools/channels.js';
import { registerRefreshTools } from './tools/refresh.js';

const registrars: ToolRegistrar[] = [registerReadTools, registerRefreshTools, registerChannelTools];
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/tools`
Expected: all PASS. The SDK returns schema validation failures as `isError: true` results whose text names the failing field, which satisfies the `/confirm/i` assertion. If the SDK instead throws an MCP error to the client, wrap the `callTool` in the confirm tests with `.catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e) }] }))` and keep the assertions.

- [ ] **Step 8: Commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add refresh and channel action tools with confirm gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rules, groups and ordering tools

**Files:**
- Create: `src/tools/rules.ts`, `src/tools/groups.ts`, `src/tools/ordering.ts`
- Modify: `src/server.ts`
- Test: `test/tools/config-tools.test.ts`

**Interfaces:**
- Produces: `registerRulesTools`, `registerGroupTools`, `registerOrderingTools`; tools `podium_rules`, `podium_upload_rules`, `podium_set_group`, `podium_set_ordering`.

- [ ] **Step 1: Write the failing tests**

`test/tools/config-tools.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connect, mockClient } from '../helpers.js';

describe('rules, groups and ordering tools', () => {
  it('podium_rules save forwards fields', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({
      name: 'podium_rules',
      arguments: { action: 'save', channelId: 3, aliases: ['a'], contains: ['b'], exclude: [], providers: ['p'], minResolution: '1080p' },
    });
    expect(client.saveRules).toHaveBeenCalledWith(3, { aliases: ['a'], contains: ['b'], exclude: [], providers: ['p'], minResolution: '1080p' });
    await mcp.close();
  });

  it('podium_rules clear calls clearRulePatterns', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_rules', arguments: { action: 'clear', channelId: 3 } });
    expect(client.clearRulePatterns).toHaveBeenCalledWith(3);
    expect(client.saveRules).not.toHaveBeenCalled();
    await mcp.close();
  });

  it('podium_upload_rules rejects invalid JSON before calling Podium', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_upload_rules', arguments: { rulesJson: '{not json' } });
    expect(r.isError).toBe(true);
    expect(client.uploadRules).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_upload_rules', arguments: { rulesJson: '{"rules":[]}' } });
    expect(client.uploadRules).toHaveBeenCalledWith('{"rules":[]}');
    await mcp.close();
  });

  it('podium_set_group target=group requires groupId and forwards body', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'group', mode: 'worker' } });
    expect(r.isError).toBe(true);
    await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'group', groupId: 5, mode: 'worker', measureOnly: true } });
    expect(client.setGroup).toHaveBeenCalledWith(5, { mode: 'worker', measureOnly: true });
    await mcp.close();
  });

  it('podium_set_group target=pattern requires pattern and forwards body', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'pattern', mode: 'measure' } });
    expect(r.isError).toBe(true);
    await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'pattern', pattern: 'Sports*', mode: 'measure' } });
    expect(client.setGroupPattern).toHaveBeenCalledWith({ pattern: 'Sports*', mode: 'measure' });
    await mcp.close();
  });

  it('podium_set_group rejects a call with neither mode nor measureOnly', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'group', groupId: 5 } });
    expect(r.isError).toBe(true);
    expect(client.setGroup).not.toHaveBeenCalled();
    await mcp.close();
  });

  it('podium_set_ordering forwards mode, providerPreference and weights', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({
      name: 'podium_set_ordering',
      arguments: { mode: 'quality', providerPreference: ['a', 'b'], weights: { fps: 0.5, preferH265: true, hdrPreference: 'pq' } },
    });
    expect(client.setOrdering).toHaveBeenCalledWith({
      mode: 'quality',
      providerPreference: ['a', 'b'],
      weights: { fps: 0.5, preferH265: true, hdrPreference: 'pq' },
    });
    await mcp.close();
  });

  it('podium_set_ordering rejects an empty update', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_set_ordering', arguments: {} });
    expect(r.isError).toBe(true);
    expect(client.setOrdering).not.toHaveBeenCalled();
    await mcp.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/tools/config-tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/rules.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

const ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const registerRulesTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_rules',
    {
      title: 'Save or clear channel match rules',
      description: 'action=save stores aliases/contains/exclude/providers/minResolution rules for a channel. action=clear removes the channel patterns.',
      inputSchema: {
        action: z.enum(['save', 'clear']),
        channelId: z.number().int(),
        aliases: z.array(z.string()).optional(),
        contains: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        providers: z.array(z.string()).optional(),
        minResolution: z.union([z.string(), z.number()]).optional(),
      },
      annotations: ACTION,
    },
    ({ action, channelId, ...rules }) => {
      if (action === 'clear') return run(`Cleared patterns for channel ${channelId}`, () => client.clearRulePatterns(channelId));
      const body = Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== undefined));
      return run(`Saved rules for channel ${channelId}`, () => client.saveRules(channelId, body));
    },
  );

  server.registerTool(
    'podium_upload_rules',
    {
      title: 'Upload stream-ordering rules',
      description: 'Upload the contents of a stream-ordering-rules.json file. Podium merges it with existing rules and reports existing/generated/replaced counts.',
      inputSchema: { rulesJson: z.string().min(2).describe('Raw JSON text of the rules file') },
      annotations: ACTION,
    },
    ({ rulesJson }) => {
      try {
        JSON.parse(rulesJson);
      } catch (e) {
        return Promise.resolve(fail(`rulesJson is not valid JSON: ${e instanceof Error ? e.message : String(e)}`));
      }
      return run('Uploaded rules', () => client.uploadRules(rulesJson));
    },
  );
};
```

- [ ] **Step 4: Implement `src/tools/groups.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

export const registerGroupTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_set_group',
    {
      title: 'Set group mode',
      description:
        'target=group sets mode and/or measureOnly on one stream group by id. target=pattern sets a rule by group-name pattern. Podium has no endpoint to list existing patterns.',
      inputSchema: {
        target: z.enum(['group', 'pattern']),
        groupId: z.number().int().optional().describe('Required when target=group'),
        pattern: z.string().optional().describe('Required when target=pattern'),
        mode: z.string().optional().describe('Group mode, e.g. worker or measure'),
        measureOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ target, groupId, pattern, mode, measureOnly }) => {
      if (mode === undefined && measureOnly === undefined) return fail('Provide mode and/or measureOnly');
      const body: { mode?: string; measureOnly?: boolean } = {};
      if (mode !== undefined) body.mode = mode;
      if (measureOnly !== undefined) body.measureOnly = measureOnly;

      if (target === 'group') {
        if (groupId === undefined) return fail('groupId is required when target is "group"');
        return run(`Updated group ${groupId}`, () => client.setGroup(groupId, body));
      }
      if (pattern === undefined || pattern === '') return fail('pattern is required when target is "pattern"');
      return run(`Updated group pattern "${pattern}"`, () => client.setGroupPattern({ pattern, ...body }));
    },
  );
};
```

- [ ] **Step 5: Implement `src/tools/ordering.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import type { OrderingRequest } from '../podium/types.js';
import { fail, run } from './result.js';

const weightsSchema = z
  .object({
    resolution: z.number().optional(),
    bitrate: z.number().optional(),
    fps: z.number().optional(),
    codec: z.number().optional(),
    audio: z.number().optional(),
    hdr: z.number().optional(),
    preferH265: z.boolean().optional(),
    hdrPreference: z.string().optional(),
    hevcBitrateFactor: z.number().optional(),
    uhdBitrateKbps: z.number().optional(),
  })
  .optional();

export const registerOrderingTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_set_ordering',
    {
      title: 'Set ordering config',
      description: 'Update ordering mode, provider preference and/or quality weights. Read the current values with podium_get_ordering first. At least one field is required.',
      inputSchema: {
        mode: z.string().optional(),
        providerPreference: z.array(z.string()).optional(),
        weights: weightsSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ mode, providerPreference, weights }) => {
      const body: OrderingRequest = {};
      if (mode !== undefined) body.mode = mode;
      if (providerPreference !== undefined) body.providerPreference = providerPreference;
      if (weights !== undefined) body.weights = weights;
      if (Object.keys(body).length === 0) return fail('Provide at least one of mode, providerPreference, weights');
      return run('Updated ordering configuration', () => client.setOrdering(body));
    },
  );
};
```

- [ ] **Step 6: Register in `src/server.ts`**

```ts
import { registerGroupTools } from './tools/groups.js';
import { registerOrderingTools } from './tools/ordering.js';
import { registerRulesTools } from './tools/rules.js';

const registrars: ToolRegistrar[] = [
  registerReadTools,
  registerRefreshTools,
  registerChannelTools,
  registerRulesTools,
  registerGroupTools,
  registerOrderingTools,
];
```

- [ ] **Step 7: Run the tests to verify they pass, then commit**

Run: `npx vitest run test/tools/config-tools.test.ts`
Expected: 8 tests PASS.

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add rules, group and ordering tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Settings and Teamarr tools

**Files:**
- Create: `src/tools/settings.ts`, `src/tools/teamarr.ts`
- Modify: `src/server.ts`
- Test: `test/tools/settings-teamarr.test.ts`

**Interfaces:**
- Consumes: `stripSecrets` is not needed here; uses `client.getSettings()` to discover secret keys.
- Produces: `registerSettingsTools`, `registerTeamarrTools`; tools `podium_settings`, `podium_teamarr_sync`.

- [ ] **Step 1: Write the failing tests**

`test/tools/settings-teamarr.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connect, mockClient, textOf } from '../helpers.js';

const settings = {
  fields: [
    { key: 'DISPATCHARR_URL', kind: 'string' },
    { key: 'DISPATCHARR_API_KEY', kind: 'secret' },
    { key: 'TICK_MS', kind: 'number' },
  ],
  effective: {},
};

describe('podium_settings', () => {
  it('test forwards values to testSettings', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_settings', arguments: { action: 'test', values: { TICK_MS: 30000 } } });
    expect(client.testSettings).toHaveBeenCalledWith({ TICK_MS: 30000 });
    expect(client.saveSettings).not.toHaveBeenCalled();
    await mcp.close();
  });

  it('save forwards values to saveSettings', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_settings', arguments: { action: 'save', values: { TICK_MS: 30000 } } });
    expect(client.saveSettings).toHaveBeenCalledWith({ TICK_MS: 30000 });
    await mcp.close();
  });

  it('rejects secret keys for both actions', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    for (const action of ['test', 'save']) {
      const r = await mcp.callTool({ name: 'podium_settings', arguments: { action, values: { DISPATCHARR_API_KEY: 'x' } } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/DISPATCHARR_API_KEY/);
    }
    expect(client.testSettings).not.toHaveBeenCalled();
    expect(client.saveSettings).not.toHaveBeenCalled();
    await mcp.close();
  });

  it('rejects unknown keys', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_settings', arguments: { action: 'save', values: { NOPE: 1 } } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/NOPE/);
    await mcp.close();
  });

  it('rejects an empty values object', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_settings', arguments: { action: 'save', values: {} } });
    expect(r.isError).toBe(true);
    await mcp.close();
  });
});

describe('podium_teamarr_sync', () => {
  it('sync defaults to dryRun=true', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_teamarr_sync', arguments: { action: 'sync' } });
    expect(client.teamarrSync).toHaveBeenCalledWith(true);
    await mcp.close();
  });

  it('sync with dryRun=false runs live', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_teamarr_sync', arguments: { action: 'sync', dryRun: false } });
    expect(client.teamarrSync).toHaveBeenCalledWith(false);
    await mcp.close();
  });

  it('test calls teamarrSyncTest', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_teamarr_sync', arguments: { action: 'test' } });
    expect(client.teamarrSyncTest).toHaveBeenCalledOnce();
    expect(client.teamarrSync).not.toHaveBeenCalled();
    await mcp.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/tools/settings-teamarr.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/tools/settings.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

export const registerSettingsTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_settings',
    {
      title: 'Test or save settings',
      description:
        'action=test validates settings against Dispatcharr without saving; action=save persists them. Keys come from podium_get_settings. Secret settings (e.g. API keys) cannot be changed through this server.',
      inputSchema: {
        action: z.enum(['test', 'save']),
        values: z.record(z.string(), z.unknown()).describe('Map of setting key to new value'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ action, values }) => {
      const keys = Object.keys(values);
      if (keys.length === 0) return fail('values must contain at least one setting');

      return run(action === 'test' ? 'Settings test result' : 'Settings saved', async () => {
        const current = await client.getSettings();
        const byKey = new Map(current.fields.map((f) => [f.key, f]));
        const unknown = keys.filter((k) => !byKey.has(k));
        if (unknown.length > 0) throw new Error(`Unknown setting key(s): ${unknown.join(', ')}`);
        const secret = keys.filter((k) => byKey.get(k)?.kind === 'secret');
        if (secret.length > 0) {
          throw new Error(`Refusing to change secret setting(s) via MCP: ${secret.join(', ')}. Set these in Podium directly.`);
        }
        return action === 'test' ? client.testSettings(values) : client.saveSettings(values);
      });
    },
  );
};
```

- [ ] **Step 4: Implement `src/tools/teamarr.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { run } from './result.js';

export const registerTeamarrTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_teamarr_sync',
    {
      title: 'Teamarr rules sync',
      description: 'action=sync runs the Teamarr rules sync (dryRun defaults to true; pass dryRun=false to apply). action=test checks Teamarr connectivity.',
      inputSchema: {
        action: z.enum(['sync', 'test']),
        dryRun: z.boolean().default(true).describe('Only for action=sync. Default true.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ action, dryRun }) => {
      if (action === 'test') return run('Teamarr connectivity test', () => client.teamarrSyncTest());
      return run(dryRun ? 'Teamarr sync (dry run)' : 'Teamarr sync', () => client.teamarrSync(dryRun));
    },
  );
};
```

- [ ] **Step 5: Register in `src/server.ts`**

```ts
import { registerSettingsTools } from './tools/settings.js';
import { registerTeamarrTools } from './tools/teamarr.js';

const registrars: ToolRegistrar[] = [
  registerReadTools,
  registerRefreshTools,
  registerChannelTools,
  registerRulesTools,
  registerGroupTools,
  registerOrderingTools,
  registerSettingsTools,
  registerTeamarrTools,
];
```

- [ ] **Step 6: Run the tests to verify they pass, then commit**

Run: `npx vitest run test/tools/settings-teamarr.test.ts`
Expected: 8 tests PASS.

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add settings and Teamarr sync tools with secret protection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Opt-in destructive tools

**Files:**
- Create: `src/tools/dangerous.ts`
- Modify: `src/server.ts`
- Test: `test/tools/dangerous.test.ts`

**Interfaces:**
- Consumes: `Config.enableDestructive`, `confirmSchema`.
- Produces: `registerDangerousTools`; tools `podium_backup`, `podium_reset_state` (conditional).

- [ ] **Step 1: Write the failing tests**

`test/tools/dangerous.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connect, mockClient, textOf } from '../helpers.js';

describe('destructive tools', () => {
  it('are absent when the flag is off', async () => {
    const mcp = await connect(mockClient(), { enableDestructive: false });
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('podium_backup');
    expect(names).not.toContain('podium_reset_state');
    await mcp.close();
  });

  it('are present with destructiveHint when the flag is on', async () => {
    const mcp = await connect(mockClient(), { enableDestructive: true });
    const tools = (await mcp.listTools()).tools;
    for (const n of ['podium_backup', 'podium_reset_state']) {
      const t = tools.find((x) => x.name === n);
      expect(t, n).toBeDefined();
      expect(t!.annotations?.destructiveHint, n).toBe(true);
    }
    await mcp.close();
  });

  it('podium_backup export does not need confirm', async () => {
    const client = mockClient({ backup: { kind: 'podium-backup', version: 1 } });
    const mcp = await connect(client, { enableDestructive: true });
    const r = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'export' } });
    expect(r.isError).toBeUndefined();
    expect(client.backup).toHaveBeenCalledOnce();
    await mcp.close();
  });

  it('podium_backup restore requires confirm and valid backup JSON', async () => {
    const client = mockClient();
    const mcp = await connect(client, { enableDestructive: true });
    const noConfirm = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{"kind":"podium-backup"}' } });
    expect(noConfirm.isError).toBe(true);
    const badJson = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{oops', confirm: true } });
    expect(badJson.isError).toBe(true);
    const wrongKind = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{"kind":"other"}', confirm: true } });
    expect(wrongKind.isError).toBe(true);
    expect(textOf(wrongKind)).toMatch(/podium-backup/);
    expect(client.restoreBackup).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{"kind":"podium-backup","version":1}', confirm: true } });
    expect(client.restoreBackup).toHaveBeenCalledWith({ kind: 'podium-backup', version: 1 });
    await mcp.close();
  });

  it('podium_reset_state requires confirm', async () => {
    const client = mockClient();
    const mcp = await connect(client, { enableDestructive: true });
    const r = await mcp.callTool({ name: 'podium_reset_state', arguments: {} });
    expect(r.isError).toBe(true);
    expect(client.resetState).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_reset_state', arguments: { confirm: true } });
    expect(client.resetState).toHaveBeenCalledOnce();
    await mcp.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/tools/dangerous.test.ts`
Expected: the first test passes by accident, the rest FAIL.

- [ ] **Step 3: Implement `src/tools/dangerous.ts`**

```ts
import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { confirmSchema, fail, run } from './result.js';

const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export const registerDangerousTools: ToolRegistrar = (server, { client, config }) => {
  if (!config.enableDestructive) return;

  server.registerTool(
    'podium_backup',
    {
      title: 'Export or restore a Podium backup',
      description:
        'action=export returns the full Podium backup JSON (may include configuration, handle with care). action=restore REPLACES Podium configuration with the supplied backup. Restore requires confirm=true.',
      inputSchema: {
        action: z.enum(['export', 'restore']),
        backupJson: z.string().optional().describe('Required for restore: the JSON text of a podium-backup document'),
        confirm: z.literal(true).optional().describe('Required (true) for restore'),
      },
      annotations: DESTRUCTIVE,
    },
    ({ action, backupJson, confirm }) => {
      if (action === 'export') return run('Podium backup export', () => client.backup());
      if (confirm !== true) return fail('restore requires confirm=true. Ask the user for explicit confirmation first.');
      if (!backupJson) return fail('backupJson is required for restore');
      let parsed: unknown;
      try {
        parsed = JSON.parse(backupJson);
      } catch (e) {
        return fail(`backupJson is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (typeof parsed !== 'object' || parsed === null || (parsed as { kind?: unknown }).kind !== 'podium-backup') {
        return fail('backupJson must be a Podium backup document with kind "podium-backup"');
      }
      return run('Restored Podium backup', () => client.restoreBackup(parsed));
    },
  );

  server.registerTool(
    'podium_reset_state',
    {
      title: 'Reset Podium state',
      description: 'Clears Podium cache and run history. Does not change Dispatcharr, but all measurement data is lost. Requires confirm=true.',
      inputSchema: { confirm: confirmSchema },
      annotations: DESTRUCTIVE,
    },
    () => run('Podium state reset', () => client.resetState()),
  );
};
```

- [ ] **Step 4: Register in `src/server.ts`**

```ts
import { registerDangerousTools } from './tools/dangerous.js';

const registrars: ToolRegistrar[] = [
  registerReadTools,
  registerRefreshTools,
  registerChannelTools,
  registerRulesTools,
  registerGroupTools,
  registerOrderingTools,
  registerSettingsTools,
  registerTeamarrTools,
  registerDangerousTools,
];
```

- [ ] **Step 5: Run the tests to verify they pass, then commit**

Run: `npx vitest run test/tools/dangerous.test.ts`
Expected: 5 tests PASS.

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add opt-in backup and reset tools behind env flag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Transports and entrypoint

**Files:**
- Create: `src/transport/http.ts`, `src/transport/stdio.ts`, `src/index.ts`
- Test: `test/http.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/transport/http.ts
  export function createHttpApp(deps: { buildServer: () => McpServer; authToken?: string }): express.Express;
  export function startHttp(deps: { buildServer: () => McpServer; authToken?: string; port: number }): Promise<http.Server>;
  // src/transport/stdio.ts
  export async function startStdio(server: McpServer): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

`test/http.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from '../src/transport/http.js';
import { buildServer } from '../src/server.js';
import { mockClient, testConfig } from './helpers.js';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function start(authToken?: string) {
  const client = mockClient({ health: { status: 'ok', worker: 'active', heartbeatAgeSeconds: 1 } });
  const cfg = testConfig();
  const deps = { buildServer: () => buildServer(client, cfg), port: 0 } as { buildServer: () => ReturnType<typeof buildServer>; port: number; authToken?: string };
  if (authToken) deps.authToken = authToken;
  server = await startHttp(deps);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('http transport', () => {
  it('serves /healthz without auth', async () => {
    const base = await start('secret');
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects /mcp without a bearer token when MCP_AUTH_TOKEN is set', async () => {
    const base = await start('secret');
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('completes an MCP session over HTTP with the right token', async () => {
    const base = await start('secret');
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: 'Bearer secret' } },
    });
    const mcp = new Client({ name: 't', version: '0' });
    await mcp.connect(transport);
    const { tools } = await mcp.listTools();
    expect(tools.some((t) => t.name === 'podium_health')).toBe(true);
    const r = await mcp.callTool({ name: 'podium_health', arguments: {} });
    expect(r.structuredContent).toMatchObject({ status: 'ok' });
    await mcp.close();
  });

  it('allows /mcp without auth when no token is configured', async () => {
    const base = await start();
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
    const mcp = new Client({ name: 't', version: '0' });
    await mcp.connect(transport);
    expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
    await mcp.close();
  });

  it('returns 400 for a non-initialize request without a session', async () => {
    const base = await start();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/http.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/transport/http.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../log.js';

export interface HttpDeps {
  buildServer: () => McpServer;
  authToken?: string;
}

function bearerAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    if (header === `Bearer ${token}`) {
      next();
      return;
    }
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  };
}

export function createHttpApp(deps: HttpDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  if (deps.authToken) app.use('/mcp', bearerAuth(deps.authToken));

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.all('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session' }, id: null });
        return;
      }
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, created);
          log.debug('session started', { id });
        },
        onsessionclosed: (id) => {
          transports.delete(id);
          log.debug('session closed', { id });
        },
      });
      created.onclose = () => {
        if (created.sessionId) transports.delete(created.sessionId);
      };
      await deps.buildServer().connect(created);
      transport = created;
    }

    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

export function startHttp(deps: HttpDeps & { port: number }): Promise<Server> {
  const app = createHttpApp(deps);
  return new Promise((resolve) => {
    const server = app.listen(deps.port, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : deps.port;
      log.info(`podium-mcp listening on http://0.0.0.0:${port}/mcp (auth ${deps.authToken ? 'enabled' : 'disabled'})`);
      resolve(server);
    });
  });
}
```

- [ ] **Step 4: Implement `src/transport/stdio.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { log } from '../log.js';

export async function startStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('podium-mcp running on stdio');
}
```

- [ ] **Step 5: Implement `src/index.ts`**

```ts
#!/usr/bin/env node
import { loadConfig } from './config.js';
import { log } from './log.js';
import { PodiumClient } from './podium/client.js';
import { buildServer } from './server.js';
import { startHttp } from './transport/http.js';
import { startStdio } from './transport/stdio.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
  log.setLevel(config.logLevel);

  const clientOpts: ConstructorParameters<typeof PodiumClient>[0] = {
    baseUrl: config.podiumUrl,
    timeoutMs: config.podiumTimeoutMs,
  };
  if (config.podiumToken) clientOpts.token = config.podiumToken;
  const client = new PodiumClient(clientOpts);

  log.info(`Podium target: ${config.podiumUrl}; destructive tools ${config.enableDestructive ? 'ENABLED' : 'disabled'}`);

  if (config.transport === 'stdio') {
    await startStdio(buildServer(client, config));
    return;
  }

  const deps: Parameters<typeof startHttp>[0] = { buildServer: () => buildServer(client, config), port: config.port };
  if (config.mcpAuthToken) deps.authToken = config.mcpAuthToken;
  const server = await startHttp(deps);

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error('fatal', e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/http.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 7: Manual check of both transports**

Run:
```bash
npm run build
PODIUM_URL=http://podium.example:3000 MCP_PORT=18080 node dist/index.js &
sleep 1; curl -s http://127.0.0.1:18080/healthz; kill %1
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' | PODIUM_URL=http://podium.example:3000 MCP_TRANSPORT=stdio node dist/index.js
```
Expected: first prints `{"ok":true}`; second prints a JSON-RPC initialize result on stdout and the "running on stdio" log line on stderr.

- [ ] **Step 8: Commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "feat: add streamable HTTP and stdio transports with entrypoint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Docker packaging

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `.env.example`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
coverage
.git
.github
docs
test
scripts
*.md
.env
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_PORT=8080
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD [ "$MCP_TRANSPORT" = "http" ] && wget -qO- "http://127.0.0.1:${MCP_PORT}/healthz" > /dev/null || exit 1
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Create `docker-compose.example.yml`**

```yaml
# Copy to docker-compose.yml and edit the environment values.
services:
  podium-mcp:
    image: ghcr.io/OWNER/podium-mcp:latest   # replace OWNER, or use `build: .`
    container_name: podium-mcp
    restart: unless-stopped
    ports:
      - "8080:8080"                          # host:container; change the host side if 8080 is taken
    environment:
      # Required. Base URL of your Podium instance as reachable from this container.
      PODIUM_URL: "http://podium.example:3000"
      # Optional. Bearer token to send to Podium if you front it with an authenticating proxy.
      # PODIUM_TOKEN: ""
      # Optional. Bearer token clients must present to this MCP server. Strongly recommended if
      # the port is reachable from anywhere other than localhost.
      # MCP_AUTH_TOKEN: "change-me"
      # Optional. Register the backup-restore and state-reset tools. Off by default.
      PODIUM_MCP_ENABLE_DESTRUCTIVE: "false"
      # Optional. debug | info | warn | error
      LOG_LEVEL: "info"
```

- [ ] **Step 4: Create `.env.example`**

```
# Required: base URL of your Podium instance
PODIUM_URL=http://podium.example:3000

# Optional: bearer token sent to Podium (only if you have a proxy that needs it)
# PODIUM_TOKEN=

# Optional: request timeout in ms
# PODIUM_TIMEOUT_MS=30000

# http (default) or stdio
MCP_TRANSPORT=http
MCP_PORT=8080

# Optional: bearer token clients must send to this server's /mcp endpoint
# MCP_AUTH_TOKEN=

# Register backup restore and state reset tools (true/false)
PODIUM_MCP_ENABLE_DESTRUCTIVE=false

LOG_LEVEL=info
```

- [ ] **Step 5: Build and run the image locally**

Run:
```bash
docker build -t podium-mcp:dev .
docker run --rm -d --name podium-mcp-test -p 18081:8080 -e PODIUM_URL=http://podium.example:3000 podium-mcp:dev
sleep 2; curl -s http://127.0.0.1:18081/healthz; docker inspect --format='{{.State.Health.Status}}' podium-mcp-test
docker stop podium-mcp-test
```
Expected: `{"ok":true}` and a health status of `starting` or `healthy`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: add multi-stage Dockerfile, compose example and env template

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: GitHub Actions CI, release and Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  docker:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build image (no push)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          load: true
          tags: podium-mcp:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Smoke-run image
        run: |
          docker run -d --name smoke -p 18080:8080 -e PODIUM_URL=http://podium.example:3000 podium-mcp:ci
          for i in $(seq 1 20); do
            if curl -fs http://127.0.0.1:18080/healthz; then echo; exit 0; fi
            sleep 1
          done
          docker logs smoke
          exit 1
```

- [ ] **Step 2: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write
  packages: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint && npm run typecheck && npm test

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

Note: `github.repository` is `owner/repo`, so the image name follows the repo name. GHCR image names are lower-cased automatically by metadata-action.

- [ ] **Step 3: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev-dependencies:
        dependency-type: development
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 4: Validate YAML parses**

Run: `node -e "const y=require('node:fs');for(const f of ['.github/workflows/ci.yml','.github/workflows/release.yml','.github/dependabot.yml']){y.readFileSync(f,'utf8');console.log('ok',f)}"`
Expected: three `ok` lines. (Full workflow validation happens on the first push to GitHub; if `actionlint` is installed locally, run `actionlint` too.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: add CI, GHCR release workflow and Dependabot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Sanitised API reference, README and licence

**Files:**
- Create: `docs/podium-api.md`, `README.md`, `LICENSE`

- [ ] **Step 1: Create `docs/podium-api.md`**

```markdown
# Podium HTTP API reference

Podium is a provider-aware stream checker and reorderer for Dispatcharr. This
document describes the HTTP API that `podium-mcp` wraps, as observed on
2026-09-17. It is not official Podium documentation; endpoints may change.

- Base URL: your Podium instance, e.g. `http://<podium-host>:<port>`
- Auth: none by default. If you front Podium with an authenticating proxy,
  `podium-mcp` can send a bearer token (`PODIUM_TOKEN`).
- Content type: JSON for all bodies unless noted.

Notes:

- All `GET` endpoints are reads, with one caveat: `GET /api/state?refresh=1`
  forces Podium to refetch from Dispatcharr, which is slow and counts against
  Dispatcharr's own rate limiting.
- `POST /api/apply`, `POST /api/unassign`, `POST /api/backup` (restore) and
  `POST /api/state/reset` change live state. `apply` and `unassign` modify
  Dispatcharr channels.
- Podium itself holds the Dispatcharr URL and API key. `podium-mcp` never
  needs Dispatcharr credentials.
- `POST /api/rule-check` takes the raw text of a rules JSON file, not a JSON
  object wrapper.
- `PUT /api/group-patterns` has no matching `GET`; existing patterns cannot
  be listed.

## Read-only (GET)

| Endpoint | Returns |
|---|---|
| `/api/health` | `{status, worker, heartbeatAgeSeconds}` |
| `/api/stats` | Worker status, stream state counts (total/measured/healthy, alive/dead/black/low_bitrate/unmeasured), primary channel health, per-provider breakdown, freshness |
| `/api/progress` | `{progress:{runId, phase, probed, dead, reordered, heldBack:{reason:count}, nextRunAt, tickMs}, runs:[], stats, stale, refresh:{all, groups:{}}}` |
| `/api/dead` | `{totals, providers, channels, entries, entryTotal, truncated}` |
| `/api/state[?refresh=1]` | `{groups, patterns, providers}` |
| `/api/streams?q=<text>` | `{groups, total, truncated}`; `q` must be 2+ chars |
| `/api/stream-groups` | `{excludeGroups:[], groups:[{id, name, streams, claimed, excluded, excludedBy}], totalStreams, excludedStreams}` |
| `/api/ordering` | `{mode, providerPreference:[], weights:{resolution, bitrate, fps, codec, audio, hdr, preferH265, hdrPreference, hevcBitrateFactor, uhdBitrateKbps}, defaults:{}, providers:[]}` |
| `/api/quality-profile?minSamples=N[&eventOnly=0&include=&exclude=]` | Quality profile data used by rule generation |
| `/api/rule-check` | `{rulesUploadedAt, ruleCount, history:[], latest:[]}` |
| `/api/name-noise[?q=<text>]` | `{strip:[], entries:[], candidate, totalStreams}` |
| `/api/settings` | `{fields:[{key, kind, label, help, section, value, isSet, source, defaultValue}], effective:{}}`; fields with `kind:"secret"` have masked values |
| `/api/backup` | Full backup document `{kind:"podium-backup", version, createdAt, rules:{...}, ...}` |
| `/api/teamarr-sync` | `{configured, scheduled, everyMs, deferred, minSamples, minChannels, lastAttemptAt, nextAt, last}` |

## Mutating (POST / PUT / DELETE)

| Endpoint | Method | Body / notes |
|---|---|---|
| `/api/refresh` | POST | `{scope:"all"}` or `{scope:"group", groupId}` — queue a check run |
| `/api/refresh?scope=all` | DELETE | Cancel the queued all-scope refresh |
| `/api/refresh?scope=group&groupId=N` | DELETE | Cancel a queued group refresh |
| `/api/preview` | POST | `{channelId, aliases:[], contains:[], exclude:[], providers:[]}` — dry run, changes nothing |
| `/api/check/{channelId}[?force=true]` | POST | Probe all streams on one channel. Accepts `{}` body. Response includes `probed`, `dead` and whether apply is `allowed` |
| `/api/apply/{channelId}` | POST | `{order:[streamIds], removeUnmatched, force, allowAssign}`. `force:true` needed when the check said `allowed:false`. Modifies Dispatcharr |
| `/api/unassign/{channelId}` | POST | `{streamId}`. Modifies Dispatcharr |
| `/api/rules/{channelId}` | PUT | `{aliases:[], contains:[], exclude:[], providers:[], minResolution}` |
| `/api/rules/{channelId}/patterns` | DELETE | Clear the channel's patterns |
| `/api/groups/{groupId}` | PUT | `{mode}` and/or `{measureOnly}` |
| `/api/group-patterns` | PUT | `{pattern, mode, measureOnly}`; no GET |
| `/api/ordering` | PUT | `{mode, providerPreference:[], weights:{...}}`; numbers coerced to finite |
| `/api/rule-check` | POST | Raw text of a `stream-ordering-rules.json` file; response `{existing, generated, replaced}` |
| `/api/settings` | PUT | `{KEY: value, ...}`; errors as `{errors:[{key, message}]}` |
| `/api/settings/test` | POST | Same body as PUT; returns `{ok, providers:[{name, maxStreams}]}` without saving |
| `/api/teamarr-sync[?dryRun=1]` | POST | Trigger the Teamarr rules sync |
| `/api/teamarr-sync/test` | POST | `{ok, byType:{}}` |
| `/api/backup` | POST | Restore from a full backup document. Replaces configuration |
| `/api/state/reset` | POST | Clears cache and run history |
```

- [ ] **Step 2: Create `README.md`**

```markdown
# podium-mcp

An [MCP](https://modelcontextprotocol.io) server for [Podium](https://github.com/), the
provider-aware stream checker and reorderer for Dispatcharr. It lets Claude and
other MCP clients inspect Podium's state, run checks, preview and apply stream
orderings, and manage rules and settings.

You run it yourself, next to your own Podium instance. Nothing is hosted.

## Quick start (Docker)

```bash
docker run -d --name podium-mcp \
  -p 8080:8080 \
  -e PODIUM_URL=http://<podium-host>:<port> \
  -e MCP_AUTH_TOKEN=change-me \
  ghcr.io/OWNER/podium-mcp:latest
```

Or copy `docker-compose.example.yml` to `docker-compose.yml`, edit the values,
and run `docker compose up -d`.

Check it is up: `curl http://localhost:8080/healthz` returns `{"ok":true}`.

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PODIUM_URL` | yes | — | Base URL of your Podium instance |
| `PODIUM_TOKEN` | no | — | Bearer token sent to Podium (only if a proxy in front of it needs one) |
| `PODIUM_TIMEOUT_MS` | no | `30000` | Per-request timeout |
| `MCP_TRANSPORT` | no | `http` | `http` (streamable HTTP) or `stdio` |
| `MCP_PORT` | no | `8080` | Listen port for HTTP |
| `MCP_AUTH_TOKEN` | no | — | Bearer token clients must send to `/mcp`. Set this if the port is reachable beyond localhost |
| `PODIUM_MCP_ENABLE_DESTRUCTIVE` | no | `false` | Register `podium_backup` and `podium_reset_state` |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

## Connecting a client

### Claude Code (HTTP)

```bash
claude mcp add --transport http podium http://localhost:8080/mcp \
  --header "Authorization: Bearer change-me"
```

### Claude Desktop (HTTP)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "podium": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer change-me" }
    }
  }
}
```

### Any client (stdio via Docker)

```json
{
  "mcpServers": {
    "podium": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PODIUM_URL=http://<podium-host>:<port>",
        "-e", "MCP_TRANSPORT=stdio",
        "ghcr.io/OWNER/podium-mcp:latest"
      ]
    }
  }
}
```

## Tools

Read-only:

| Tool | What it does |
|---|---|
| `podium_health` | Service and worker health |
| `podium_stats` | Stream state counts, provider breakdown, freshness |
| `podium_progress` | Current or last checker run |
| `podium_dead` | Dead, black and orphan streams |
| `podium_state` | Channel/group view; `refresh: true` refetches from Dispatcharr |
| `podium_search_streams` | Search streams by name (2+ chars) |
| `podium_stream_groups` | Groups with counts and exclusion status |
| `podium_get_ordering` | Ordering mode and weights |
| `podium_quality_profile` | Quality profile data |
| `podium_rule_status` | Uploaded rules status |
| `podium_name_noise` | Name-noise detector output |
| `podium_get_settings` | Settings (secrets masked and removed from the effective map) |
| `podium_teamarr_status` | Teamarr sync status |

Actions:

| Tool | What it does | Guard |
|---|---|---|
| `podium_refresh` | Queue or cancel a check run | — |
| `podium_preview_channel` | Dry-run stream matching | none needed |
| `podium_check_channel` | Probe one channel's streams | — |
| `podium_apply_ordering` | Apply a stream order in Dispatcharr | `confirm: true` |
| `podium_unassign_stream` | Remove a stream from a channel | `confirm: true` |
| `podium_rules` | Save or clear channel match rules | — |
| `podium_set_group` | Set group mode by id or name pattern | — |
| `podium_set_ordering` | Update ordering mode and weights | — |
| `podium_upload_rules` | Upload a rules JSON file | — |
| `podium_settings` | Test or save settings; secret keys are refused | — |
| `podium_teamarr_sync` | Run (dry-run by default) or test Teamarr sync | `dryRun: false` to apply |

Opt-in (`PODIUM_MCP_ENABLE_DESTRUCTIVE=true`):

| Tool | What it does | Guard |
|---|---|---|
| `podium_backup` | Export, or restore a backup | `confirm: true` for restore |
| `podium_reset_state` | Clear Podium cache and history | `confirm: true` |

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`) so clients
that honour them can prompt appropriately.

## Safety notes

- `podium_apply_ordering` and `podium_unassign_stream` change live Dispatcharr
  channels through Podium. The `confirm: true` argument is a guard against
  accidental calls by a model. It is not a security boundary. Anyone who can
  reach the `/mcp` endpoint can call these tools, so set `MCP_AUTH_TOKEN` and
  keep the port off the public internet.
- The server never reads or writes Dispatcharr credentials. Secret settings are
  masked on read and refused on write.
- Podium has no endpoint to list group-name patterns, so `podium_set_group`
  with `target: "pattern"` is write-only.

## Development

```bash
npm install
npm test
npm run build
PODIUM_URL=http://<podium-host>:<port> npm start
```

`npm run smoke` calls every read tool once against the Podium at `PODIUM_URL`.

Releases: push a tag like `v0.1.0` and GitHub Actions publishes a multi-arch
image to GHCR and creates a GitHub Release.

## Licence

MIT. See `LICENSE`.
```

Replace `OWNER` in the README with the actual GitHub owner once the repo exists. Replace the Podium link placeholder with Podium's actual repository URL if known, otherwise remove the link and keep the plain text.

- [ ] **Step 3: Create `LICENSE`**

Standard MIT text with `Copyright (c) 2026 podium-mcp contributors`.

- [ ] **Step 4: Scan the repo for leaked private details**

Run: `git grep -nIE '(192\.168|10|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]+\.[0-9]+' -- . ':!docs/superpowers'`  then also grep for any provider names, group names or ports from your own setup.
Expected: no output. If anything matches, remove it before committing. The private-IP regex is generic on purpose; the plan itself must never list the author's real values.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add README, sanitised Podium API reference and MIT licence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Local smoke script

**Files:**
- Create: `scripts/smoke.ts`

**Interfaces:**
- Consumes: `buildServer`, `PodiumClient`, `loadConfig`, `InMemoryTransport`.

- [ ] **Step 1: Create `scripts/smoke.ts`**

```ts
// Calls every read-only tool once against a real Podium. Run with:
//   PODIUM_URL=http://<podium-host>:<port> npm run smoke
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { PodiumClient } from '../src/podium/client.js';
import { buildServer } from '../src/server.js';

const READ_CALLS: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: 'podium_health', args: {} },
  { name: 'podium_stats', args: {} },
  { name: 'podium_progress', args: {} },
  { name: 'podium_dead', args: {} },
  { name: 'podium_state', args: {} },
  { name: 'podium_search_streams', args: { query: 'hd' } },
  { name: 'podium_stream_groups', args: {} },
  { name: 'podium_get_ordering', args: {} },
  { name: 'podium_quality_profile', args: { minSamples: 1 } },
  { name: 'podium_rule_status', args: {} },
  { name: 'podium_name_noise', args: {} },
  { name: 'podium_get_settings', args: {} },
  { name: 'podium_teamarr_status', args: {} },
  { name: 'podium_preview_channel', args: { channelId: 1 } },
];

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const opts: ConstructorParameters<typeof PodiumClient>[0] = { baseUrl: config.podiumUrl, timeoutMs: config.podiumTimeoutMs };
  if (config.podiumToken) opts.token = config.podiumToken;
  const server = buildServer(new PodiumClient(opts), config);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const mcp = new Client({ name: 'smoke', version: '0' });
  await mcp.connect(ct);

  let failures = 0;
  for (const call of READ_CALLS) {
    const started = Date.now();
    const r = await mcp.callTool({ name: call.name, arguments: call.args });
    const ms = Date.now() - started;
    const text = (r.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
    const firstLine = text.split('\n')[0] ?? '';
    if (r.isError) {
      failures++;
      console.log(`FAIL ${call.name} (${ms}ms): ${firstLine}`);
    } else {
      console.log(`ok   ${call.name} (${ms}ms): ${firstLine}`);
    }
  }
  await mcp.close();
  console.log(failures === 0 ? 'All read tools succeeded.' : `${failures} tool(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (`scripts` is in `tsconfig.json` include.)

- [ ] **Step 3: Run it against a real Podium (author only, not in CI)**

Run: `PODIUM_URL=<your real Podium URL> npm run smoke`
Expected: a line per tool, most `ok`. `podium_preview_channel` with channelId 1 may `FAIL` if that channel does not exist; that is acceptable and confirms error mapping works.

- [ ] **Step 4: Final full verification and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build && docker build -t podium-mcp:dev .`
Expected: all PASS.

```bash
git add -A
git commit -m "chore: add local smoke script for read tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §3.1 client: Tasks 3 to 5. §3.2 tools: Tasks 6 to 11. §3.3 entrypoint and transports: Task 12. §3.4 config: Task 2. §4 tool surface: every tool in §4.1, §4.2, §4.3 has a registering task and a test. §4.4 confirm: `confirmSchema` in Task 8, used in Tasks 8 and 11. §5 Docker: Task 13. §6 CI: Task 14. §7 testing: harness in Task 6, HTTP test in Task 12, smoke in Task 16. §8 docs: Task 15. §9 out of scope: nothing added.
- Deviation from spec §3.2: the text content carries the summary and the full JSON, not only a summary, so clients that ignore `structuredContent` still get the data. Recorded in Task 6.
- Type consistency checked: client method names in Task 4/5 match the `METHODS` list in Task 6 and every call in Tasks 7 to 11 and 16.
