import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import type { PodiumClient } from './podium/client.js';

export interface ToolContext {
  client: PodiumClient;
  config: Config;
}

export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

// Tool groups are appended here by later tasks.
const registrars: ToolRegistrar[] = [];

export const SERVER_INFO = { name: 'podium-mcp', version: '0.1.0' } as const;

// The SDK only wires up the tools/list and tools/call request handlers the
// first time a tool is registered (see McpServer#setToolRequestHandlers).
// Register and immediately remove a throwaway tool so those handlers exist
// even before any registrar (or with none at all, as in this task) has
// added a real tool; otherwise tools/list responds with "Method not found".
function ensureToolHandlersWired(server: McpServer): void {
  server.registerTool('__bootstrap__', {}, async () => ({ content: [] })).remove();
}

export function buildServer(client: PodiumClient, config: Config): McpServer {
  const server = new McpServer(SERVER_INFO);
  const ctx: ToolContext = { client, config };
  for (const register of registrars) register(server, ctx);
  ensureToolHandlersWired(server);
  return server;
}
