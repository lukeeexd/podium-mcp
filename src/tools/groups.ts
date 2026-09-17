import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

export const registerGroupTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_set_group',
    {
      title: 'Set group mode',
      description:
        'target=group sets mode and/or measureOnly on one stream group by id. target=pattern sets a rule by group-name pattern. Podium has no endpoint to list existing patterns.',
      inputSchema: {
        target: z.enum(['group', 'pattern']),
        groupId: z.number().int().optional().describe('Required when target=group'),
        pattern: z.string().optional().describe('Required when target=pattern'),
        mode: z.string().optional().describe('Group mode, e.g. worker or measure'),
        measureOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ target, groupId, pattern, mode, measureOnly }) => {
      if (mode === undefined && measureOnly === undefined) return fail('Provide mode and/or measureOnly');
      const body: { mode?: string; measureOnly?: boolean } = {};
      if (mode !== undefined) body.mode = mode;
      if (measureOnly !== undefined) body.measureOnly = measureOnly;

      if (target === 'group') {
        if (groupId === undefined) return fail('groupId is required when target is "group"');
        return run(`Updated group ${groupId}`, () => client.setGroup(groupId, body));
      }
      if (pattern === undefined || pattern === '') return fail('pattern is required when target is "pattern"');
      return run(`Updated group pattern "${pattern}"`, () => client.setGroupPattern({ pattern, ...body }));
    },
  );
};
