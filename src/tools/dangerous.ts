import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { confirmSchema, fail, run } from './result.js';

const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export const registerDangerousTools: ToolRegistrar = (server, { client, config }) => {
  if (!config.enableDestructive) return;

  server.registerTool(
    'podium_backup',
    {
      title: 'Export or restore a Podium backup',
      description:
        'action=export returns the full Podium backup JSON (may include configuration, handle with care). action=restore REPLACES Podium configuration with the supplied backup. Restore requires confirm=true.',
      inputSchema: {
        action: z.enum(['export', 'restore']),
        backupJson: z.string().optional().describe('Required for restore: the JSON text of a podium-backup document'),
        confirm: z.literal(true).optional().describe('Required (true) for restore'),
      },
      annotations: DESTRUCTIVE,
    },
    ({ action, backupJson, confirm }) => {
      if (action === 'export') return run('Podium backup export', () => client.backup());
      if (confirm !== true) return fail('restore requires confirm=true. Ask the user for explicit confirmation first.');
      if (!backupJson) return fail('backupJson is required for restore');
      let parsed: unknown;
      try {
        parsed = JSON.parse(backupJson);
      } catch (e) {
        return fail(`backupJson is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (typeof parsed !== 'object' || parsed === null || (parsed as { kind?: unknown }).kind !== 'podium-backup') {
        return fail('backupJson must be a Podium backup document with kind "podium-backup"');
      }
      return run('Restored Podium backup', () => client.restoreBackup(parsed));
    },
  );

  server.registerTool(
    'podium_reset_state',
    {
      title: 'Reset Podium state',
      description: 'Clears Podium cache and run history. Does not change Dispatcharr, but all measurement data is lost. Requires confirm=true.',
      inputSchema: { confirm: confirmSchema },
      annotations: DESTRUCTIVE,
    },
    () => run('Podium state reset', () => client.resetState()),
  );
};
