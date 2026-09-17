import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { fail, run } from './result.js';

export const registerSettingsTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_settings',
    {
      title: 'Test or save settings',
      description:
        'action=test validates settings against Dispatcharr without saving; action=save persists them. Keys come from podium_get_settings. Secret settings (e.g. API keys) cannot be changed through this server.',
      inputSchema: {
        action: z.enum(['test', 'save']),
        values: z.record(z.string(), z.unknown()).describe('Map of setting key to new value'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ action, values }) => {
      const keys = Object.keys(values);
      if (keys.length === 0) return fail('values must contain at least one setting');

      return run(action === 'test' ? 'Settings test result' : 'Settings saved', async () => {
        const current = await client.getSettings();
        const byKey = new Map(current.fields.map((f) => [f.key, f]));
        const unknown = keys.filter((k) => !byKey.has(k));
        if (unknown.length > 0) throw new Error(`Unknown setting key(s): ${unknown.join(', ')}`);
        const secret = keys.filter((k) => byKey.get(k)?.kind === 'secret');
        if (secret.length > 0) {
          throw new Error(`Refusing to change secret setting(s) via MCP: ${secret.join(', ')}. Set these in Podium directly.`);
        }
        return action === 'test' ? client.testSettings(values) : client.saveSettings(values);
      });
    },
  );
};
