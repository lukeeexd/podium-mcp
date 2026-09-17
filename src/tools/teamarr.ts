import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { run } from './result.js';

export const registerTeamarrTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_teamarr_sync',
    {
      title: 'Teamarr rules sync',
      description: 'action=sync runs the Teamarr rules sync (dryRun defaults to true; pass dryRun=false to apply). action=test checks Teamarr connectivity.',
      inputSchema: {
        action: z.enum(['sync', 'test']),
        dryRun: z.boolean().default(true).describe('Only for action=sync. Default true.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ action, dryRun }) => {
      if (action === 'test') return run('Teamarr connectivity test', () => client.teamarrSyncTest());
      return run(dryRun ? 'Teamarr sync (dry run)' : 'Teamarr sync', () => client.teamarrSync(dryRun));
    },
  );
};
