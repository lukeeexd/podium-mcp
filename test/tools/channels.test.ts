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
