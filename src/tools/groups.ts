import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { defined, fail, run } from './result.js';
import { GROUP_MODES, groupFilter, resolution } from './schemas.js';

export const registerGroupTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_set_group',
    {
      title: 'Set group rule',
      description:
        'target=group sets the rule for one stream group by id. target=pattern sets a rule by group-name glob. mode is required because Podium resets an omitted mode to "always"; read the current mode from podium_state first if you only mean to change another field. Other fields keep their stored value when omitted. Existing patterns are listed in podium_state under patterns.',
      inputSchema: {
        target: z.enum(['group', 'pattern']),
        groupId: z.number().int().optional().describe('Required when target=group'),
        pattern: z.string().optional().describe('Required when target=pattern'),
        mode: z.enum(GROUP_MODES).describe('When the worker may reorder channels in this group'),
        measureOnly: z.boolean().optional().describe('Probe and measure streams but never reorder'),
        minResolution: resolution('floor', false),
        maxResolution: resolution('ceiling', false),
        groupFilter,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ target, groupId, pattern, ...fields }) => {
      const body = defined(fields);
      if (target === 'group') {
        if (groupId === undefined) return fail('groupId is required when target is "group"');
        return run(`Updated group ${groupId}`, () => client.setGroup(groupId, body));
      }
      if (pattern === undefined || pattern === '') return fail('pattern is required when target is "pattern"');
      return run(`Updated group pattern "${pattern}"`, () => client.setGroupPattern({ pattern, ...body }));
    },
  );

  server.registerTool(
    'podium_delete_group_pattern',
    {
      title: 'Delete group pattern',
      description: 'Remove a group-name pattern rule (matched case-insensitively). podium_state lists existing patterns under patterns. Groups it covered fall back to their own rule or the default.',
      inputSchema: { pattern: z.string().min(1).describe('The pattern exactly as it was saved') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ pattern }) => run(`Deleted group pattern "${pattern}"`, () => client.deleteGroupPattern(pattern)),
  );
};
