import { describe, expect, it, vi } from 'vitest';
import { PodiumClient } from '../../src/podium/client.js';
import { PodiumError } from '../../src/podium/errors.js';

const BASE = 'http://podium.example:3000';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Subclass to reach the protected request() method in tests.
class TestClient extends PodiumClient {
  call<T>(method: string, path: string, init?: Parameters<PodiumClient['request']>[2]) {
    return this.request<T>(method, path, init);
  }
}

describe('PodiumClient core', () => {
  it('builds the URL from baseUrl and path and sends JSON headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    const out = await client.call('GET', '/api/health');
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/health`);
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
  });

  it('appends only defined query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('GET', '/api/streams', { query: { q: 'news', limit: 5, flag: true, skip: undefined } });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/api/streams?q=news&limit=5&flag=true`);
  });

  it('sends a bearer token when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, token: 'tok', timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('GET', '/api/health');
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer tok');
  });

  it('serialises a json body with content-type application/json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('POST', '/api/refresh', { json: { scope: 'all' } });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBe('{"scope":"all"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('sends a text body with content-type text/plain', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('POST', '/api/rule-check', { text: '{"rules":[]}' });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBe('{"rules":[]}');
    expect(new Headers(init.headers).get('content-type')).toBe('text/plain');
  });

  it('returns an empty object for an empty 2xx body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    expect(await client.call('DELETE', '/api/refresh')).toEqual({});
  });

  it('throws PodiumError with status, method, path and body on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"nope"}', { status: 400 }));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    const err = (await client.call('POST', '/api/apply/1', { json: {} }).catch((e: unknown) => e)) as PodiumError;
    expect(err).toBeInstanceOf(PodiumError);
    expect(err.status).toBe(400);
    expect(err.method).toBe('POST');
    expect(err.path).toBe('/api/apply/1');
    expect(err.body).toBe('{"error":"nope"}');
    expect(err.message).toMatch(/400/);
  });

  it('throws PodiumError with status 0 on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    const err = (await client.call('GET', '/api/health').catch((e: unknown) => e)) as PodiumError;
    expect(err).toBeInstanceOf(PodiumError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/fetch failed/);
  });

  it('passes an AbortSignal so requests time out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new TestClient({ baseUrl: BASE, timeoutMs: 1000 }, fetchMock as unknown as typeof fetch);
    await client.call('GET', '/api/health');
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
});
