import { describe, expect, it } from 'vitest';
import { connect, mockClient, textOf } from '../helpers.js';

describe('rules, groups and ordering tools', () => {
  it('podium_rules save forwards fields', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({
      name: 'podium_rules',
      arguments: {
        action: 'save', channelId: 3, aliases: ['a'], contains: ['b'], exclude: [], providers: [2],
        minResolution: '1080p', maxResolution: 'inherit', groupFilter: null, aliasProviders: { a: [2] },
      },
    });
    expect(client.saveRules).toHaveBeenCalledWith(3, {
      aliases: ['a'], contains: ['b'], exclude: [], providers: [2],
      minResolution: '1080p', maxResolution: 'inherit', groupFilter: null, aliasProviders: { a: [2] },
    });
    await mcp.close();
  });

  it('podium_rules save requires aliases, contains and exclude', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_rules', arguments: { action: 'save', channelId: 3, aliases: ['a'], maxResolution: '1080p' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/aliases, contains and exclude/);
    expect(client.saveRules).not.toHaveBeenCalled();
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
    const r = await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'group', mode: 'never' } });
    expect(r.isError).toBe(true);
    await mcp.callTool({
      name: 'podium_set_group',
      arguments: { target: 'group', groupId: 5, mode: 'never', measureOnly: true, maxResolution: '1080p', groupFilter: { excludeGroups: ['PPV*'] } },
    });
    expect(client.setGroup).toHaveBeenCalledWith(5, { mode: 'never', measureOnly: true, maxResolution: '1080p', groupFilter: { excludeGroups: ['PPV*'] } });
    await mcp.close();
  });

  it('podium_set_group target=pattern requires pattern and forwards body', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'pattern', mode: 'assigned' } });
    expect(r.isError).toBe(true);
    await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'pattern', pattern: 'Sports*', mode: 'assigned', minResolution: null } });
    expect(client.setGroupPattern).toHaveBeenCalledWith({ pattern: 'Sports*', mode: 'assigned', minResolution: null });
    await mcp.close();
  });

  it('podium_set_group requires a valid mode', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const missing = await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'group', groupId: 5, measureOnly: true } });
    expect(missing.isError).toBe(true);
    const invalid = await mcp.callTool({ name: 'podium_set_group', arguments: { target: 'group', groupId: 5, mode: 'worker' } });
    expect(invalid.isError).toBe(true);
    expect(client.setGroup).not.toHaveBeenCalled();
    await mcp.close();
  });

  it('podium_delete_group_pattern is destructive and forwards the pattern', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    const tool = (await mcp.listTools()).tools.find((t) => t.name === 'podium_delete_group_pattern');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await mcp.callTool({ name: 'podium_delete_group_pattern', arguments: { pattern: 'Sports*' } });
    expect(client.deleteGroupPattern).toHaveBeenCalledWith('Sports*');
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
