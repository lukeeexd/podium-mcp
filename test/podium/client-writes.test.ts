import { describe, expect, it, vi } from 'vitest';
import { PodiumClient } from '../../src/podium/client.js';

const BASE = 'http://podium.example:3000';

function make() {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  const client = new PodiumClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
  const calledWith = () => {
    const [url, init] = fetchMock.mock.calls[0]!;
    return {
      url: String(url).replace(BASE, ''),
      method: init.method as string,
      body: init.body as string | undefined,
      contentType: new Headers(init.headers).get('content-type'),
    };
  };
  return { client, calledWith };
}

describe('PodiumClient writes', () => {
  it('queueRefresh all', async () => {
    const { client, calledWith } = make();
    await client.queueRefresh('all');
    expect(calledWith()).toMatchObject({ url: '/api/refresh', method: 'POST', body: '{"scope":"all"}' });
  });

  it('queueRefresh group', async () => {
    const { client, calledWith } = make();
    await client.queueRefresh('group', 7);
    expect(calledWith()).toMatchObject({ url: '/api/refresh', method: 'POST', body: '{"scope":"group","groupId":7}' });
  });

  it('cancelRefresh all', async () => {
    const { client, calledWith } = make();
    await client.cancelRefresh('all');
    expect(calledWith()).toMatchObject({ url: '/api/refresh?scope=all', method: 'DELETE', body: undefined });
  });

  it('cancelRefresh group', async () => {
    const { client, calledWith } = make();
    await client.cancelRefresh('group', 7);
    expect(calledWith()).toMatchObject({ url: '/api/refresh?scope=group&groupId=7', method: 'DELETE' });
  });

  it('preview', async () => {
    const { client, calledWith } = make();
    await client.preview({ channelId: 3, aliases: ['a'] });
    expect(calledWith()).toMatchObject({ url: '/api/preview', method: 'POST', body: '{"channelId":3,"aliases":["a"]}' });
  });

  it('checkChannel without force sends empty object body', async () => {
    const { client, calledWith } = make();
    await client.checkChannel(3);
    expect(calledWith()).toMatchObject({ url: '/api/check/3', method: 'POST', body: '{}' });
  });

  it('checkChannel with force', async () => {
    const { client, calledWith } = make();
    await client.checkChannel(3, true);
    expect(calledWith()).toMatchObject({ url: '/api/check/3?force=true', method: 'POST' });
  });

  it('applyOrdering', async () => {
    const { client, calledWith } = make();
    await client.applyOrdering(3, { order: [9, 8], removeUnmatched: false, force: true, allowAssign: false });
    expect(calledWith()).toMatchObject({
      url: '/api/apply/3',
      method: 'POST',
      body: '{"order":[9,8],"removeUnmatched":false,"force":true,"allowAssign":false}',
    });
  });

  it('unassignStream', async () => {
    const { client, calledWith } = make();
    await client.unassignStream(3, 42);
    expect(calledWith()).toMatchObject({ url: '/api/unassign/3', method: 'POST', body: '{"streamId":42}' });
  });

  it('saveRules', async () => {
    const { client, calledWith } = make();
    await client.saveRules(3, { aliases: ['x'], minResolution: '720p' });
    expect(calledWith()).toMatchObject({ url: '/api/rules/3', method: 'PUT', body: '{"aliases":["x"],"minResolution":"720p"}' });
  });

  it('clearRulePatterns', async () => {
    const { client, calledWith } = make();
    await client.clearRulePatterns(3);
    expect(calledWith()).toMatchObject({ url: '/api/rules/3/patterns', method: 'DELETE' });
  });

  it('setGroup', async () => {
    const { client, calledWith } = make();
    await client.setGroup(5, { mode: 'worker', measureOnly: true });
    expect(calledWith()).toMatchObject({ url: '/api/groups/5', method: 'PUT', body: '{"mode":"worker","measureOnly":true}' });
  });

  it('setGroupPattern', async () => {
    const { client, calledWith } = make();
    await client.setGroupPattern({ pattern: 'Sports*', mode: 'measure', measureOnly: false });
    expect(calledWith()).toMatchObject({
      url: '/api/group-patterns',
      method: 'PUT',
      body: '{"pattern":"Sports*","mode":"measure","measureOnly":false}',
    });
  });

  it('setOrdering', async () => {
    const { client, calledWith } = make();
    await client.setOrdering({ mode: 'quality', weights: { fps: 0.5 } });
    expect(calledWith()).toMatchObject({ url: '/api/ordering', method: 'PUT', body: '{"mode":"quality","weights":{"fps":0.5}}' });
  });

  it('uploadRules sends text/plain', async () => {
    const { client, calledWith } = make();
    await client.uploadRules('{"rules":[]}');
    expect(calledWith()).toMatchObject({ url: '/api/rule-check', method: 'POST', body: '{"rules":[]}', contentType: 'text/plain' });
  });

  it('testSettings', async () => {
    const { client, calledWith } = make();
    await client.testSettings({ A: '1' });
    expect(calledWith()).toMatchObject({ url: '/api/settings/test', method: 'POST', body: '{"A":"1"}' });
  });

  it('saveSettings', async () => {
    const { client, calledWith } = make();
    await client.saveSettings({ A: '1' });
    expect(calledWith()).toMatchObject({ url: '/api/settings', method: 'PUT', body: '{"A":"1"}' });
  });

  it('teamarrSync dryRun', async () => {
    const { client, calledWith } = make();
    await client.teamarrSync(true);
    expect(calledWith()).toMatchObject({ url: '/api/teamarr-sync?dryRun=1', method: 'POST' });
  });

  it('teamarrSync live', async () => {
    const { client, calledWith } = make();
    await client.teamarrSync(false);
    expect(calledWith()).toMatchObject({ url: '/api/teamarr-sync', method: 'POST' });
  });

  it('teamarrSyncTest', async () => {
    const { client, calledWith } = make();
    await client.teamarrSyncTest();
    expect(calledWith()).toMatchObject({ url: '/api/teamarr-sync/test', method: 'POST' });
  });

  it('restoreBackup', async () => {
    const { client, calledWith } = make();
    await client.restoreBackup({ kind: 'podium-backup', version: 1 });
    expect(calledWith()).toMatchObject({ url: '/api/backup', method: 'POST', body: '{"kind":"podium-backup","version":1}' });
  });

  it('resetState', async () => {
    const { client, calledWith } = make();
    await client.resetState();
    expect(calledWith()).toMatchObject({ url: '/api/state/reset', method: 'POST' });
  });
});
