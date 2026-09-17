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

  it('podium_get_settings masks secret field values even when Podium sends them unmasked', async () => {
    const client = mockClient({
      getSettings: {
        fields: [
          { key: 'DISPATCHARR_URL', kind: 'string', value: 'http://x', defaultValue: 'http://y' },
          { key: 'DISPATCHARR_API_KEY', kind: 'secret', value: 'realsecret', defaultValue: 'realdefault' },
        ],
        effective: { DISPATCHARR_URL: 'http://x' },
      },
    });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_get_settings', arguments: {} });
    const serialised = JSON.stringify(r.structuredContent);
    for (const secret of ['realsecret', 'realdefault']) {
      expect(textOf(r)).not.toContain(secret);
      expect(serialised).not.toContain(secret);
    }
    // Non-secret fields are untouched.
    expect(serialised).toContain('http://y');
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
