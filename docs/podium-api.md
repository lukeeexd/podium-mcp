# Podium HTTP API reference

Podium is a provider-aware stream checker and reorderer for Dispatcharr. This
document describes the HTTP API that `podium-mcp` wraps, as of Podium
1.16.0 (checked 2026-10-18). It is not official Podium documentation;
endpoints may change.

- Base URL: your Podium instance, e.g. `http://<podium-host>:<port>`
- Auth: none by default. If Podium has `PODIUM_AUTH_TOKEN` set (or you front
  it with an authenticating proxy), `podium-mcp` sends `PODIUM_TOKEN` as a
  bearer token. Podium's `PODIUM_ALLOWED_HOSTS`, if set, must include the host
  name `podium-mcp` uses in `PODIUM_URL`.
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
- `PUT /api/group-patterns` has no matching `GET`; existing patterns are
  listed in `GET /api/state` under `patterns`.
- `PUT /api/rules/{channelId}` always rewrites `aliases`, `contains` and
  `exclude` (an omitted list is saved as empty). Every other field keeps its
  stored value when omitted.
- `PUT /api/groups/{groupId}` and `PUT /api/group-patterns` default an
  omitted `mode` to `always`. Valid modes: `always`, `never`,
  `after_epg_start`, `assigned`.
- Resolution floors and ceilings (`minResolution`, `maxResolution`) take
  `720p`, `1080p`, `2160p` (or `4k`), or `none`. On channel rules, `inherit`,
  `""` or `null` removes the override; on groups, `null` or `""` mean `none`.
- `providers` and `aliasProviders` values are numeric provider (M3U account)
  IDs. Group filters are `{includeGroups?:[], excludeGroups?:[]}` of globs over
  provider group names; `null` clears a stored filter.

## Read-only (GET)

| Endpoint | Returns |
|---|---|
| `/api/health` | `{status, version, worker, heartbeatAgeSeconds}` |
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
| `/api/connect/status` | `{state, enabled, stabilityEnabled, callbackUrl, summary:{accepted, rejected, lastReceivedAt, lastSyncAt, syncError, ...}, pending, recent:[]}`; `state` is `disabled`, `blocked`, `pending`, `error` or `listening` |

## Mutating (POST / PUT / DELETE)

| Endpoint | Method | Body / notes |
|---|---|---|
| `/api/refresh` | POST | `{scope:"all"}` or `{scope:"group", groupId}` — queue a check run |
| `/api/refresh?scope=all` | DELETE | Cancel the queued all-scope refresh |
| `/api/refresh?scope=group&groupId=N` | DELETE | Cancel a queued group refresh |
| `/api/preview` | POST | `{channelId, aliases:[], contains:[], exclude:[], providers:[], groupFilter, aliasGroupFilters, containsGroupFilters, aliasProviders, aliasProviderGroupFilters}` — dry run, changes nothing. Omitted scope fields fall back to the stored rule. Response adds `aliasSources` and `groupCounts` |
| `/api/check/{channelId}[?force=true]` | POST | Probe all streams on one channel. Accepts `{}` body. Response includes `probed`, `dead`, whether apply is `allowed`, `pruned` (stream IDs to pass to apply), `minResolution` and `maxResolution` |
| `/api/apply/{channelId}` | POST | `{order:[streamIds], removeUnmatched, force, allowAssign, pruned:[streamIds]}`. `force:true` needed when the check said `allowed:false`. With `allowAssign`, streams in `pruned` are dropped rather than kept at the tail. Modifies Dispatcharr |
| `/api/unassign/{channelId}` | POST | `{streamId}`. Modifies Dispatcharr |
| `/api/rules/{channelId}` | PUT | `{aliases:[], contains:[], exclude:[], providers:[], minResolution, maxResolution, groupFilter, aliasGroupFilters, containsGroupFilters, aliasProviders, aliasProviderGroupFilters}`. Per-alias maps are keyed by exact alias/contains text; `aliasProviderGroupFilters` is keyed by alias then provider ID |
| `/api/rules/{channelId}/patterns` | DELETE | Clear the channel's patterns |
| `/api/groups/{groupId}` | PUT | `{mode, measureOnly, minResolution, maxResolution, groupFilter}`; a floor above the ceiling is a 400 |
| `/api/group-patterns` | PUT | `{pattern, mode, measureOnly, minResolution, maxResolution, groupFilter}`; no GET |
| `/api/group-patterns?pattern=<glob>` | DELETE | Remove a pattern (case-insensitive match) |
| `/api/ordering` | PUT | `{mode, providerPreference:[], weights:{...}}`; numbers coerced to finite |
| `/api/rule-check` | POST | Raw text of a `stream-ordering-rules.json` file; response `{existing, generated, replaced}` |
| `/api/settings` | PUT | `{KEY: value, ...}`; errors as `{errors:[{key, message}]}` |
| `/api/settings/test` | POST | Same body as PUT; returns `{ok, providers:[{name, maxStreams, profiles:[{name, maxStreams}]}]}` without saving |
| `/api/teamarr-sync[?dryRun=1]` | POST | Trigger the Teamarr rules sync |
| `/api/teamarr-sync/test` | POST | `{ok, byType:{}}` |
| `/api/backup` | POST | Restore from a full backup document. Replaces configuration |
| `/api/state/reset` | POST | Clears cache and run history |
