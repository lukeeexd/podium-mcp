import { describe, expect, it } from 'vitest';
import { connect, mockClient, textOf } from '../helpers.js';

const settings = {
  fields: [
    { key: 'DISPATCHARR_URL', kind: 'string' },
    { key: 'DISPATCHARR_API_KEY', kind: 'secret' },
    { key: 'TICK_MS', kind: 'number' },
  ],
  effective: {},
};

describe('podium_settings', () => {
  it('test forwards values to testSettings', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_settings', arguments: { action: 'test', values: { TICK_MS: 30000 } } });
    expect(client.testSettings).toHaveBeenCalledWith({ TICK_MS: 30000 });
    expect(client.saveSettings).not.toHaveBeenCalled();
    await mcp.close();
  });

  it('save forwards values to saveSettings', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_settings', arguments: { action: 'save', values: { TICK_MS: 30000 } } });
    expect(client.saveSettings).toHaveBeenCalledWith({ TICK_MS: 30000 });
    await mcp.close();
  });

  it('rejects secret keys for both actions', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    for (const action of ['test', 'save']) {
      const r = await mcp.callTool({ name: 'podium_settings', arguments: { action, values: { DISPATCHARR_API_KEY: 'x' } } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/DISPATCHARR_API_KEY/);
    }
    expect(client.testSettings).not.toHaveBeenCalled();
    expect(client.saveSettings).not.toHaveBeenCalled();
    await mcp.close();
  });

  it('rejects unknown keys', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_settings', arguments: { action: 'save', values: { NOPE: 1 } } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/NOPE/);
    await mcp.close();
  });

  it('rejects an empty values object', async () => {
    const client = mockClient({ getSettings: settings });
    const mcp = await connect(client);
    const r = await mcp.callTool({ name: 'podium_settings', arguments: { action: 'save', values: {} } });
    expect(r.isError).toBe(true);
    await mcp.close();
  });
});

describe('podium_teamarr_sync', () => {
  it('sync defaults to dryRun=true', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_teamarr_sync', arguments: { action: 'sync' } });
    expect(client.teamarrSync).toHaveBeenCalledWith(true);
    await mcp.close();
  });

  it('sync with dryRun=false runs live', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_teamarr_sync', arguments: { action: 'sync', dryRun: false } });
    expect(client.teamarrSync).toHaveBeenCalledWith(false);
    await mcp.close();
  });

  it('test calls teamarrSyncTest', async () => {
    const client = mockClient();
    const mcp = await connect(client);
    await mcp.callTool({ name: 'podium_teamarr_sync', arguments: { action: 'test' } });
    expect(client.teamarrSyncTest).toHaveBeenCalledOnce();
    expect(client.teamarrSync).not.toHaveBeenCalled();
    await mcp.close();
  });
});
