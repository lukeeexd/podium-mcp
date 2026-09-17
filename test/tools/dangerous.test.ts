import { describe, expect, it } from 'vitest';
import { connect, mockClient, textOf } from '../helpers.js';

describe('destructive tools', () => {
  it('are absent when the flag is off', async () => {
    const mcp = await connect(mockClient(), { enableDestructive: false });
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('podium_backup');
    expect(names).not.toContain('podium_reset_state');
    await mcp.close();
  });

  it('are present with destructiveHint when the flag is on', async () => {
    const mcp = await connect(mockClient(), { enableDestructive: true });
    const tools = (await mcp.listTools()).tools;
    for (const n of ['podium_backup', 'podium_reset_state']) {
      const t = tools.find((x) => x.name === n);
      expect(t, n).toBeDefined();
      expect(t!.annotations?.destructiveHint, n).toBe(true);
    }
    await mcp.close();
  });

  it('podium_backup export does not need confirm', async () => {
    const client = mockClient({ backup: { kind: 'podium-backup', version: 1 } });
    const mcp = await connect(client, { enableDestructive: true });
    const r = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'export' } });
    expect(r.isError).toBeUndefined();
    expect(client.backup).toHaveBeenCalledOnce();
    await mcp.close();
  });

  it('podium_backup restore requires confirm and valid backup JSON', async () => {
    const client = mockClient();
    const mcp = await connect(client, { enableDestructive: true });
    const noConfirm = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{"kind":"podium-backup"}' } });
    expect(noConfirm.isError).toBe(true);
    const badJson = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{oops', confirm: true } });
    expect(badJson.isError).toBe(true);
    const wrongKind = await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{"kind":"other"}', confirm: true } });
    expect(wrongKind.isError).toBe(true);
    expect(textOf(wrongKind)).toMatch(/podium-backup/);
    expect(client.restoreBackup).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_backup', arguments: { action: 'restore', backupJson: '{"kind":"podium-backup","version":1}', confirm: true } });
    expect(client.restoreBackup).toHaveBeenCalledWith({ kind: 'podium-backup', version: 1 });
    await mcp.close();
  });

  it('podium_reset_state requires confirm', async () => {
    const client = mockClient();
    const mcp = await connect(client, { enableDestructive: true });
    const r = await mcp.callTool({ name: 'podium_reset_state', arguments: {} });
    expect(r.isError).toBe(true);
    expect(client.resetState).not.toHaveBeenCalled();
    await mcp.callTool({ name: 'podium_reset_state', arguments: { confirm: true } });
    expect(client.resetState).toHaveBeenCalledOnce();
    await mcp.close();
  });
});
