import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import type { QualityProfileQuery, SettingsResponse } from '../podium/types.js';
import { run } from './result.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** What a secret field's value and default are replaced with, whatever upstream sent. */
const MASK = '••••';

export function stripSecrets(settings: SettingsResponse): SettingsResponse {
  const allFields = settings.fields ?? [];
  const secretKeys = new Set(allFields.filter((f) => f.kind === 'secret').map((f) => f.key));
  // Podium is expected to mask secrets already, but never trust that: re-mask here so a
  // misconfigured or older Podium cannot hand a real credential to the model.
  const fields = allFields.map((f) =>
    f.kind === 'secret' ? { ...f, value: MASK, defaultValue: MASK } : f,
  );
  const effective: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings.effective ?? {})) {
    if (!secretKeys.has(k)) effective[k] = v;
  }
  return { ...settings, fields, effective };
}

export const registerReadTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_health',
    { title: 'Podium health', description: 'Health of the Podium service and its background worker.', annotations: READ },
    () => run('Podium health', () => client.health()),
  );

  server.registerTool(
    'podium_stats',
    {
      title: 'Podium stats',
      description: 'Worker status, stream state counts (alive/dead/black/low bitrate/unmeasured), primary channel health, per-provider breakdown and data freshness.',
      annotations: READ,
    },
    () => run('Podium stats', () => client.stats()),
  );

  server.registerTool(
    'podium_progress',
    { title: 'Checker progress', description: 'Current or last checker run: phase, probed/dead/reordered counts, held-back reasons, next run time.', annotations: READ },
    () => run('Checker progress', () => client.progress()),
  );

  server.registerTool(
    'podium_dead',
    { title: 'Dead streams', description: 'Dead, black and orphan streams grouped by provider and channel.', annotations: READ },
    () => run('Dead streams', () => client.dead()),
  );

  server.registerTool(
    'podium_state',
    {
      title: 'Channel and group state',
      description:
        'Main channel/group view: groups, patterns and providers. Set refresh=true to force Podium to refetch from Dispatcharr first (slower, and counts against Dispatcharr rate limits).',
      inputSchema: { refresh: z.boolean().default(false).describe('Force a refetch from Dispatcharr before returning') },
      annotations: { ...READ, idempotentHint: false },
    },
    ({ refresh }) => run(refresh ? 'Channel state (refreshed from Dispatcharr)' : 'Channel state', () => client.state(refresh)),
  );

  server.registerTool(
    'podium_search_streams',
    {
      title: 'Search streams',
      description: 'Search streams by name. Query must be at least 2 characters.',
      inputSchema: { query: z.string().min(2).describe('Text to search for (min 2 chars)') },
      annotations: READ,
    },
    ({ query }) => run(`Streams matching "${query}"`, () => client.searchStreams(query)),
  );

  server.registerTool(
    'podium_stream_groups',
    { title: 'Stream groups', description: 'All stream groups with stream counts, claimed/excluded status and totals.', annotations: READ },
    () => run('Stream groups', () => client.streamGroups()),
  );

  server.registerTool(
    'podium_get_ordering',
    { title: 'Get ordering config', description: 'Current ordering mode, provider preference, quality weights and defaults.', annotations: READ },
    () => run('Ordering configuration', () => client.getOrdering()),
  );

  server.registerTool(
    'podium_quality_profile',
    {
      title: 'Quality profile',
      description: 'Quality profile data used for rule generation.',
      inputSchema: {
        minSamples: z.number().int().min(1).describe('Minimum measured samples per entry'),
        eventOnly: z.boolean().optional().describe('Restrict to event channels'),
        include: z.string().optional().describe('Include filter'),
        exclude: z.string().optional().describe('Exclude filter'),
      },
      annotations: READ,
    },
    (args) => {
      const query: QualityProfileQuery = { minSamples: args.minSamples };
      if (args.eventOnly !== undefined) query.eventOnly = args.eventOnly;
      if (args.include !== undefined) query.include = args.include;
      if (args.exclude !== undefined) query.exclude = args.exclude;
      return run('Quality profile', () => client.qualityProfile(query));
    },
  );

  server.registerTool(
    'podium_rule_status',
    { title: 'Rule status', description: 'Status of uploaded stream-ordering rules: upload time, rule count, history and latest results.', annotations: READ },
    () => run('Rule status', () => client.ruleStatus()),
  );

  server.registerTool(
    'podium_name_noise',
    {
      title: 'Name noise',
      description: 'Name-noise detector output: strip tokens, entries and candidates. Optional query narrows results.',
      inputSchema: { query: z.string().optional().describe('Optional filter text') },
      annotations: READ,
    },
    ({ query }) => run('Name noise', () => client.nameNoise(query)),
  );

  server.registerTool(
    'podium_get_settings',
    {
      title: 'Get settings',
      description: 'Podium settings fields with current values. Secret values are masked and secret keys are removed from the effective map.',
      annotations: READ,
    },
    () => run('Settings', async () => stripSecrets(await client.getSettings())),
  );

  server.registerTool(
    'podium_teamarr_status',
    { title: 'Teamarr sync status', description: 'Teamarr rules sync configuration and last/next run.', annotations: READ },
    () => run('Teamarr sync status', () => client.teamarrStatus()),
  );
};
