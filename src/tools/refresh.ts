import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

export const registerRefreshTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_refresh',
    {
      title: 'Queue or cancel a check run',
      description:
        'Queue a checker run (action=queue) or cancel a queued run (action=cancel) for all groups or one group. Queuing triggers stream probing against providers.',
      inputSchema: {
        action: z.enum(['queue', 'cancel']),
        scope: z.enum(['all', 'group']),
        groupId: z.number().int().optional().describe('Required when scope=group'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action, scope, groupId }) => {
      if (scope === 'group' && groupId === undefined) return fail('groupId is required when scope is "group"');
      if (action === 'queue') {
        return run(`Queued ${scope} refresh`, () => client.queueRefresh(scope, groupId));
      }
      return run(`Cancelled ${scope} refresh`, () => client.cancelRefresh(scope, groupId));
    },
  );
};
