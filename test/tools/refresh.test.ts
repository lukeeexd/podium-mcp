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
