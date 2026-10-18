import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { defined, fail, run } from './result.js';
import { matchScope, resolution } from './schemas.js';

const ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const registerRulesTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_rules',
    {
      title: 'Save or clear channel match rules',
      description:
        'action=save stores match rules for a channel. aliases, contains and exclude are required on save and REPLACE the stored lists, so read the current values from podium_state first and pass them back unchanged if you are only changing other fields. Every other field keeps its stored value when omitted. action=clear removes the channel patterns.',
      inputSchema: {
        action: z.enum(['save', 'clear']),
        channelId: z.number().int(),
        aliases: z.array(z.string()).optional().describe('Required for save. Replaces the stored aliases'),
        contains: z.array(z.string()).optional().describe('Required for save. Replaces the stored contains lines'),
        exclude: z.array(z.string()).optional().describe('Required for save. Replaces the stored exclude lines'),
        ...matchScope,
        minResolution: resolution('floor', true),
        maxResolution: resolution('ceiling', true),
      },
      annotations: ACTION,
    },
    ({ action, channelId, aliases, contains, exclude, ...rest }) => {
      if (action === 'clear') return run(`Cleared patterns for channel ${channelId}`, () => client.clearRulePatterns(channelId));
      // Podium rewrites all three lists on every save, so an omitted list would silently erase it.
      if (aliases === undefined || contains === undefined || exclude === undefined) {
        return Promise.resolve(
          fail('aliases, contains and exclude are all required for save (pass the current values from podium_state to keep them)'),
        );
      }
      const body = { aliases, contains, exclude, ...defined(rest) };
      return run(`Saved rules for channel ${channelId}`, () => client.saveRules(channelId, body));
    },
  );

  server.registerTool(
    'podium_upload_rules',
    {
      title: 'Upload stream-ordering rules',
      description: 'Upload the contents of a stream-ordering-rules.json file. Podium merges it with existing rules and reports existing/generated/replaced counts.',
      inputSchema: { rulesJson: z.string().min(2).describe('Raw JSON text of the rules file') },
      annotations: ACTION,
    },
    ({ rulesJson }) => {
      try {
        JSON.parse(rulesJson);
      } catch (e) {
        return Promise.resolve(fail(`rulesJson is not valid JSON: ${e instanceof Error ? e.message : String(e)}`));
      }
      return run('Uploaded rules', () => client.uploadRules(rulesJson));
    },
  );
};
