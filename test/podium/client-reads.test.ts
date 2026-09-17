import { describe, expect, it, vi } from 'vitest';
import { PodiumClient } from '../../src/podium/client.js';

const BASE = 'http://podium.example:3000';

function make() {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  const client = new PodiumClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
  const calledWith = () => {
    const [url, init] = fetchMock.mock.calls[0]!;
    return { url: String(url).replace(BASE, ''), method: init.method as string };
  };
  return { client, calledWith };
}

describe('PodiumClient reads', () => {
  const cases: Array<[string, (c: PodiumClient) => Promise<unknown>, string]> = [
    ['health', (c) => c.health(), '/api/health'],
    ['stats', (c) => c.stats(), '/api/stats'],
    ['progress', (c) => c.progress(), '/api/progress'],
    ['dead', (c) => c.dead(), '/api/dead'],
    ['state', (c) => c.state(), '/api/state'],
    ['state refresh', (c) => c.state(true), '/api/state?refresh=1'],
    ['searchStreams', (c) => c.searchStreams('news'), '/api/streams?q=news'],
    ['streamGroups', (c) => c.streamGroups(), '/api/stream-groups'],
    ['getOrdering', (c) => c.getOrdering(), '/api/ordering'],
    ['qualityProfile min', (c) => c.qualityProfile({ minSamples: 3 }), '/api/quality-profile?minSamples=3'],
    [
      'qualityProfile full',
      (c) => c.qualityProfile({ minSamples: 3, eventOnly: false, include: 'a', exclude: 'b' }),
      '/api/quality-profile?minSamples=3&eventOnly=0&include=a&exclude=b',
    ],
    ['ruleStatus', (c) => c.ruleStatus(), '/api/rule-check'],
    ['nameNoise', (c) => c.nameNoise(), '/api/name-noise'],
    ['nameNoise q', (c) => c.nameNoise('hd'), '/api/name-noise?q=hd'],
    ['getSettings', (c) => c.getSettings(), '/api/settings'],
    ['backup', (c) => c.backup(), '/api/backup'],
    ['teamarrStatus', (c) => c.teamarrStatus(), '/api/teamarr-sync'],
  ];

  for (const [name, fn, expectedUrl] of cases) {
    it(`${name} GETs ${expectedUrl}`, async () => {
      const { client, calledWith } = make();
      await fn(client);
      expect(calledWith()).toEqual({ url: expectedUrl, method: 'GET' });
    });
  }
});
