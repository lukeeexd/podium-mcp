import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { log } from '../log.js';

export async function startStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('podium-mcp running on stdio');
}
