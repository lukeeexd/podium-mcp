# Podium MCP Server — Design

Date: 2026-09-17
Status: approved for planning

## 1. Purpose

An MCP server that wraps the HTTP API of Podium, a provider-aware stream checker
and reorderer for Dispatcharr. It lets an MCP client (Claude Desktop, Claude Code,
or any other) read Podium's state and drive its actions through typed tools.

The repository is public on GitHub. Each user runs their own instance against
their own Podium. It is not hosted for anyone. Nothing in the repo may contain a
real host address, port of a real deployment, provider name, group name or any
other detail of the author's setup.

## 2. Decisions taken

| Topic | Decision |
|---|---|
| Language | TypeScript, Node 22, official `@modelcontextprotocol/sdk` |
| Transports | Both streamable HTTP (default) and stdio, chosen by env var |
| Tool surface | Curated set of 24 default tools (13 read-only, 11 actions) plus 2 opt-in destructive tools |
| Confirmation | Required `confirm: true` argument on destructive tools; MCP annotations on all tools |
| Secrets | Secret-kind settings never written through the server; effective map stripped of secret keys |
| Distribution | GitHub Actions publishes multi-arch (amd64, arm64) image to GHCR on `v*` tags |
| Testing | Vitest, mocked fetch; no live Podium in CI; local smoke script |

## 3. Architecture

Three layers in one Node service.

### 3.1 Podium client — `src/podium/client.ts`, `src/podium/types.ts`

- Constructed with `{ baseUrl, token?, timeoutMs }`.
- One method per Podium endpoint. Response types in `types.ts` follow the API
  reference in `docs/podium-api.md`. Types are descriptive, not exhaustive;
  unknown fields pass through.
- Uses global `fetch`. Sends `Authorization: Bearer <token>` when a token is set.
- `POST /api/rule-check` sends the body as `text/plain`, everything else as JSON.
- `DELETE /api/refresh` passes scope and groupId as query parameters.
- Every non-2xx response throws `PodiumError { status, url, body }`. Network and
  timeout failures throw `PodiumError` with `status: 0`.

### 3.2 Tools — `src/tools/*.ts`

- One file per group: `read.ts`, `refresh.ts`, `channels.ts`, `rules.ts`,
  `groups.ts`, `ordering.ts`, `settings.ts`, `teamarr.ts`, `dangerous.ts`.
- Each file exports `register(server, client, config)`.
- Inputs validated with zod. Annotations set `readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint: false` per tool.
- Tools return both `structuredContent` (raw JSON from Podium, post-processed
  where noted) and a short text summary in `content`.
- A `PodiumError` becomes a tool result with `isError: true` and a message
  containing status, path and body excerpt. The server never crashes on a
  Podium failure.
- `dangerous.ts` registers only when `PODIUM_MCP_ENABLE_DESTRUCTIVE=true`.

### 3.3 Entrypoint — `src/index.ts`, `src/config.ts`, `src/server.ts`

- `config.ts` reads and validates environment variables with zod. Missing
  `PODIUM_URL` is a fatal startup error with a clear message.
- `server.ts` builds the `McpServer`, registers tool groups, returns it.
- `index.ts` selects transport:
  - `http`: Express app with `POST/GET/DELETE /mcp` handled by
    `StreamableHTTPServerTransport`, and `GET /healthz` returning `{ ok: true }`.
    If `MCP_AUTH_TOKEN` is set, `/mcp` requires `Authorization: Bearer <token>`;
    `/healthz` never requires auth.
  - `stdio`: `StdioServerTransport`. Logs go to stderr only.

### 3.4 Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PODIUM_URL` | yes | none | Base URL of the Podium instance |
| `PODIUM_TOKEN` | no | unset | Bearer token sent to Podium (for reverse-proxied setups) |
| `PODIUM_TIMEOUT_MS` | no | `30000` | Per-request timeout |
| `MCP_TRANSPORT` | no | `http` | `http` or `stdio` |
| `MCP_PORT` | no | `8080` | Listen port for HTTP transport |
| `MCP_AUTH_TOKEN` | no | unset | Bearer token required by the HTTP transport |
| `PODIUM_MCP_ENABLE_DESTRUCTIVE` | no | `false` | Registers backup restore and state reset |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

No variable has a default that points at a real host.

## 4. Tool surface

### 4.1 Read-only (`readOnlyHint: true`)

| Tool | Endpoint | Arguments |
|---|---|---|
| `podium_health` | GET /api/health | none |
| `podium_stats` | GET /api/stats | none |
| `podium_progress` | GET /api/progress | none |
| `podium_dead` | GET /api/dead | none |
| `podium_state` | GET /api/state | `refresh?: boolean` (default false; documented as contacting Dispatcharr) |
| `podium_search_streams` | GET /api/streams?q= | `query: string` (min 2 chars) |
| `podium_stream_groups` | GET /api/stream-groups | none |
| `podium_get_ordering` | GET /api/ordering | none |
| `podium_quality_profile` | GET /api/quality-profile | `minSamples: number`, `eventOnly?: boolean`, `include?: string`, `exclude?: string` |
| `podium_rule_status` | GET /api/rule-check | none |
| `podium_name_noise` | GET /api/name-noise | `query?: string` |
| `podium_get_settings` | GET /api/settings | none. Fields with `kind: "secret"` are removed from `effective`; the `fields` list keeps them with the upstream-masked value. |
| `podium_teamarr_status` | GET /api/teamarr-sync | none |

### 4.2 Actions (`readOnlyHint: false`)

| Tool | Endpoint(s) | Arguments | Notes |
|---|---|---|---|
| `podium_refresh` | POST /api/refresh, DELETE /api/refresh | `action: "queue" \| "cancel"`, `scope: "all" \| "group"`, `groupId?: number` | groupId required when scope is group |
| `podium_preview_channel` | POST /api/preview | `channelId`, `aliases?`, `contains?`, `exclude?`, `providers?` | Dry run. `readOnlyHint: true` |
| `podium_check_channel` | POST /api/check/{id} | `channelId`, `force?: boolean` | Probes streams; no Dispatcharr write |
| `podium_apply_ordering` | POST /api/apply/{id} | `channelId`, `order: number[]`, `removeUnmatched?`, `force?`, `allowAssign?`, `confirm: true` | `destructiveHint: true`. Rejected without confirm |
| `podium_unassign_stream` | POST /api/unassign/{id} | `channelId`, `streamId`, `confirm: true` | `destructiveHint: true` |
| `podium_rules` | PUT /api/rules/{id}, DELETE /api/rules/{id}/patterns | `action: "save" \| "clear"`, `channelId`, save fields | |
| `podium_set_group` | PUT /api/groups/{id}, PUT /api/group-patterns | `target: "group" \| "pattern"`, `groupId?`, `pattern?`, `mode?`, `measureOnly?` | No GET exists for patterns; documented limitation |
| `podium_set_ordering` | PUT /api/ordering | `mode?`, `providerPreference?`, `weights?` | |
| `podium_upload_rules` | POST /api/rule-check | `rulesJson: string` | Sent as text/plain |
| `podium_settings` | POST /api/settings/test, PUT /api/settings | `action: "test" \| "save"`, `values: Record<string, unknown>` | Any key whose upstream kind is `secret` is rejected before the request |
| `podium_teamarr_sync` | POST /api/teamarr-sync, POST /api/teamarr-sync/test | `action: "sync" \| "test"`, `dryRun?: boolean` (default true) | |

### 4.3 Opt-in destructive (registered only with the flag)

| Tool | Endpoint(s) | Arguments |
|---|---|---|
| `podium_backup` | GET /api/backup, POST /api/backup | `action: "export" \| "restore"`, `backupJson?: string`, `confirm: true` for restore |
| `podium_reset_state` | POST /api/state/reset | `confirm: true` |

### 4.4 Confirm semantics

`confirm` is a literal `true` in the zod schema. A call without it fails
validation with a message telling the model to ask the user and retry with
`confirm: true`. This is a guard against accidental calls, not a security
boundary; the README says so.

## 5. Docker

- Multi-stage `Dockerfile`: `node:22-alpine` build stage compiles with `tsc`;
  runtime stage copies `dist/` and production `node_modules`, runs as user
  `node`, `EXPOSE 8080`, `HEALTHCHECK` against `/healthz`,
  `CMD ["node","dist/index.js"]`.
- `docker-compose.example.yml`: one service, image from GHCR, all env vars
  listed with placeholder values and comments.
- `.dockerignore` excludes `node_modules`, `test`, `.git`, docs.

## 6. CI and release

- `.github/workflows/ci.yml` on push and pull_request: `npm ci`, `npm run
  lint`, `npm run typecheck`, `npm test`, `docker build` (no push).
- `.github/workflows/release.yml` on tags `v*`: buildx for `linux/amd64` and
  `linux/arm64`, push to `ghcr.io/<owner>/podium-mcp` tagged `X.Y.Z`, `X.Y`,
  `latest`; create a GitHub Release with generated notes. Uses `GITHUB_TOKEN`
  with `packages: write` and `contents: write`.
- `.github/dependabot.yml` for npm and github-actions, weekly.

## 7. Testing

- Vitest. `test/client.test.ts` mocks `fetch` and asserts method, path, query
  string, headers, body encoding and error mapping for every client method.
- `test/tools/*.test.ts` build the server with a mocked client and call tools
  through the in-memory transport. Assert: schema validation, confirm
  enforcement, secret rejection in settings, secret stripping in get_settings,
  destructive tools absent without the flag, `isError` on `PodiumError`.
- `test/http.test.ts` starts the HTTP transport on a random port, asserts
  `/healthz` is open and `/mcp` is 401 without the token when one is set.
- `scripts/smoke.ts`: run locally with a real `PODIUM_URL`, calls every read
  tool once and prints a one-line result each. Not run in CI.

## 8. Documentation

- `README.md`: what it is, quick start (`docker run` and compose), env var
  table, connecting from Claude Desktop and Claude Code for both transports,
  tool list with confirm and flag semantics, safety note that actions mutate
  Dispatcharr via Podium, known limitations, licence.
- `docs/podium-api.md`: the handoff brief sections 1 to 3, rewritten with
  `http://<podium-host>:<port>` placeholders, generic wording, and a note on
  the text/plain body and the state?refresh=1 side effect. Section 4 of the
  original brief is not carried over.
- `LICENSE`: MIT.

## 9. Out of scope for v1

- MCP resources or prompts.
- Any persistence in the MCP server.
- Rate limiting or retries against Podium.
- OAuth on the HTTP transport.
