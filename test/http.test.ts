import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { startHttp } from '../src/transport/http.js';
import { buildServer } from '../src/server.js';
import { mockClient, testConfig } from './helpers.js';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function start(authToken?: string) {
  const client = mockClient({ health: { status: 'ok', worker: 'active', heartbeatAgeSeconds: 1 } });
  const cfg = testConfig();
  const deps = { buildServer: () => buildServer(client, cfg), port: 0 } as { buildServer: () => ReturnType<typeof buildServer>; port: number; authToken?: string };
  if (authToken) deps.authToken = authToken;
  server = await startHttp(deps);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('http transport', () => {
  it('serves /healthz without auth', async () => {
    const base = await start('secret');
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects /mcp without a bearer token when MCP_AUTH_TOKEN is set', async () => {
    const base = await start('secret');
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('completes an MCP session over HTTP with the right token', async () => {
    const base = await start('secret');
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: 'Bearer secret' } },
    });
    const mcp = new Client({ name: 't', version: '0' });
    await mcp.connect(transport as Transport);
    const { tools } = await mcp.listTools();
    expect(tools.some((t) => t.name === 'podium_health')).toBe(true);
    const r = await mcp.callTool({ name: 'podium_health', arguments: {} });
    expect(r.structuredContent).toMatchObject({ status: 'ok' });
    await mcp.close();
  });

  it('allows /mcp without auth when no token is configured', async () => {
    const base = await start();
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
    const mcp = new Client({ name: 't', version: '0' });
    await mcp.connect(transport as Transport);
    expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
    await mcp.close();
  });

  it('returns 400 for a non-initialize request without a session', async () => {
    const base = await start();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(400);
  });
});
