import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import type { PodiumClient } from './podium/client.js';
import { registerReadTools } from './tools/read.js';
import { registerChannelTools } from './tools/channels.js';
import { registerRefreshTools } from './tools/refresh.js';

export interface ToolContext {
  client: PodiumClient;
  config: Config;
}

export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

// Tool groups are appended here by later tasks.
const registrars: ToolRegistrar[] = [registerReadTools, registerRefreshTools, registerChannelTools];

export const SERVER_INFO = { name: 'podium-mcp', version: '0.1.0' } as const;

export function buildServer(client: PodiumClient, config: Config): McpServer {
  const server = new McpServer(SERVER_INFO);
  const ctx: ToolContext = { client, config };
  for (const register of registrars) register(server, ctx);
  return server;
}
