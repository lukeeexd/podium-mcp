# podium-mcp

An [MCP](https://modelcontextprotocol.io) server for Podium, the
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
- Through the default tool set the server never reads or writes Dispatcharr
  credentials. Secret settings are masked on read and refused on write.
- The opt-in `podium_backup` tool (behind `PODIUM_MCP_ENABLE_DESTRUCTIVE=true`)
  exports and restores Podium's raw backup document, which can include
  Podium's stored configuration and secrets. Leave the flag off unless you
  need it, and treat exported backups as sensitive.
- If `MCP_AUTH_TOKEN` is unset, the server logs a startup warning that `/mcp`
  is unauthenticated. Idle HTTP sessions are closed after 30 minutes.
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
