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
