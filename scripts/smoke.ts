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
