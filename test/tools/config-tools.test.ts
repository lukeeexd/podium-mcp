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
