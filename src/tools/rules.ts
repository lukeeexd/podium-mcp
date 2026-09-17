import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

const ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const registerRulesTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_rules',
    {
      title: 'Save or clear channel match rules',
      description: 'action=save stores aliases/contains/exclude/providers/minResolution rules for a channel. action=clear removes the channel patterns.',
      inputSchema: {
        action: z.enum(['save', 'clear']),
        channelId: z.number().int(),
        aliases: z.array(z.string()).optional(),
        contains: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        providers: z.array(z.string()).optional(),
        minResolution: z.union([z.string(), z.number()]).optional(),
      },
      annotations: ACTION,
    },
    ({ action, channelId, ...rules }) => {
      if (action === 'clear') return run(`Cleared patterns for channel ${channelId}`, () => client.clearRulePatterns(channelId));
      const body = Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== undefined));
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
