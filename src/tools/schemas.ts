import { z } from 'zod';

/** Zod fragments shared by the tools that write or preview channel and group rules. */

const id = z.number().int().nonnegative();
const globs = z.array(z.string());

/** Podium validates the value itself and answers 400 with the reason, so this stays a string. */
export function resolution(kind: 'floor' | 'ceiling', inheritable: boolean) {
  const clear = inheritable
    ? `"none" pins no ${kind} on this channel; "inherit" (or null) removes the override so the group's applies`
    : `"none" (or null) means no ${kind}`;
  return z
    .string()
    .nullable()
    .optional()
    .describe(`Resolution ${kind}: 720p, 1080p or 2160p (4k). ${clear}. Omit to keep the stored value.`);
}

export const groupFilter = z
  .object({
    includeGroups: globs.optional().describe('Only match streams whose provider group name matches one of these globs'),
    excludeGroups: globs.optional().describe('Never match streams whose provider group name matches one of these globs'),
  })
  .nullable()
  .optional()
  .describe('Provider group filter. null clears it; omit to keep the stored filter.');

const excludeOnly = z.object({ excludeGroups: globs });

/** Fields that narrow where a channel's matches come from. Shared by podium_rules and podium_preview_channel. */
export const matchScope = {
  providers: z
    .array(id)
    .optional()
    .describe('Provider (M3U account) IDs to restrict matching to, as listed by podium_state. Empty array clears the restriction.'),
  groupFilter,
  aliasGroupFilters: z
    .record(z.string(), excludeOnly)
    .optional()
    .describe('Per-alias provider group exclusions, keyed by the exact alias text'),
  containsGroupFilters: z
    .record(z.string(), excludeOnly)
    .optional()
    .describe('Per-contains-line provider group exclusions, keyed by the exact line text'),
  aliasProviders: z
    .record(z.string(), z.array(id))
    .optional()
    .describe('Per-alias provider ID allowlists, keyed by the exact alias text; an alias absent here uses the channel providers'),
  aliasProviderGroupFilters: z
    .record(z.string(), z.record(z.string(), excludeOnly))
    .optional()
    .describe('Per-alias, per-provider group exclusions: { alias: { providerId: { excludeGroups } } }'),
};

export const GROUP_MODES = ['always', 'never', 'after_epg_start', 'assigned'] as const;
