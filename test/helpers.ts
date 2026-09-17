import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { vi, type Mock } from 'vitest';
import type { Config } from '../src/config.js';
import type { PodiumClient } from '../src/podium/client.js';
import { buildServer } from '../src/server.js';

const METHODS = [
  'health', 'stats', 'progress', 'dead', 'state', 'searchStreams', 'streamGroups', 'getOrdering',
  'qualityProfile', 'ruleStatus', 'nameNoise', 'getSettings', 'backup', 'teamarrStatus',
  'queueRefresh', 'cancelRefresh', 'preview', 'checkChannel', 'applyOrdering', 'unassignStream',
  'saveRules', 'clearRulePatterns', 'setGroup', 'setGroupPattern', 'setOrdering', 'uploadRules',
  'testSettings', 'saveSettings', 'teamarrSync', 'teamarrSyncTest', 'restoreBackup', 'resetState',
] as const;

export type MockedClient = PodiumClient & Record<(typeof METHODS)[number], Mock>;

export function mockClient(overrides: Partial<Record<(typeof METHODS)[number], unknown>> = {}): MockedClient {
  const obj: Record<string, unknown> = {};
  for (const m of METHODS) {
    obj[m] = vi.fn().mockResolvedValue({ ok: true, via: m });
  }
  for (const [k, v] of Object.entries(overrides)) {
    obj[k] = typeof v === 'function' ? v : vi.fn().mockResolvedValue(v);
  }
  return obj as unknown as MockedClient;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    podiumUrl: 'http://podium.example:3000',
    podiumTimeoutMs: 1000,
    transport: 'http',
    port: 0,
    enableDestructive: false,
    logLevel: 'error',
    ...overrides,
  };
}

// @modelcontextprotocol/sdk 1.30's McpServer only wires up the tools/list and
// tools/call request handlers the first time a tool is registered (see
// McpServer#setToolRequestHandlers, guarded by _toolHandlersInitialized). A
// server built by buildServer() with zero registrars (as in Task 6, before
// any tool group exists) therefore has no tools/list handler at all, and
// `listTools()` fails with "Method not found" instead of returning `[]`.
// Work around it here, in the test harness only, by registering-then-removing
// a throwaway tool to force that one-time wiring — but only when the server
// has no registered tools yet, so this is a no-op (and never runs) once
// Task 7 registers the first real tool group. Delete this once that lands.
function ensureToolHandlersWired(server: McpServer): void {
  const registered = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
  if (registered && Object.keys(registered).length > 0) return;
  try {
    server.registerTool('__bootstrap__', {}, async () => ({ content: [] })).remove();
  } catch {
    // Handlers are already wired (or something else claimed this name) —
    // either way there is nothing further to do.
  }
}

export async function connect(client: PodiumClient, config: Partial<Config> = {}): Promise<Client> {
  const server = buildServer(client, testConfig(config));
  ensureToolHandlersWired(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'test-client', version: '0.0.0' });
  await mcp.connect(clientTransport);
  return mcp;
}

export function textOf(result: unknown): string {
  const r = result as CallToolResult;
  return r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}
