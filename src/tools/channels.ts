import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import { confirmSchema, run } from './result.js';

const ACTION = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...ACTION, destructiveHint: true } as const;

export const registerChannelTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_preview_channel',
    {
      title: 'Preview channel matching',
      description: 'Dry-run stream matching for a channel with the given rules. Changes nothing.',
      inputSchema: {
        channelId: z.number().int(),
        aliases: z.array(z.string()).default([]),
        contains: z.array(z.string()).default([]),
        exclude: z.array(z.string()).default([]),
        providers: z.array(z.string()).default([]),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) => run(`Preview for channel ${args.channelId}`, () => client.preview(args)),
  );

  server.registerTool(
    'podium_check_channel',
    {
      title: 'Check channel streams',
      description: 'Probe every stream on one channel now. Returns probed/dead counts and whether an apply is allowed. Does not modify Dispatcharr.',
      inputSchema: {
        channelId: z.number().int(),
        force: z.boolean().default(false).describe('Re-probe even if recently measured'),
      },
      annotations: ACTION,
    },
    ({ channelId, force }) => run(`Checked channel ${channelId}`, () => client.checkChannel(channelId, force)),
  );

  server.registerTool(
    'podium_apply_ordering',
    {
      title: 'Apply stream ordering',
      description:
        'Apply a stream order to a channel in Dispatcharr. MUTATES live channel state. Use podium_check_channel first; pass force=true only if the check said allowed=false and the user accepts that.',
      inputSchema: {
        channelId: z.number().int(),
        order: z.array(z.number().int()).min(1).describe('Stream IDs in the desired order'),
        removeUnmatched: z.boolean().default(false),
        force: z.boolean().default(false),
        allowAssign: z.boolean().default(false),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    ({ channelId, order, removeUnmatched, force, allowAssign }) =>
      run(`Applied ordering to channel ${channelId}`, () =>
        client.applyOrdering(channelId, { order, removeUnmatched, force, allowAssign }),
      ),
  );

  server.registerTool(
    'podium_unassign_stream',
    {
      title: 'Unassign stream from channel',
      description: 'Remove one stream from a channel in Dispatcharr. MUTATES live channel state.',
      inputSchema: {
        channelId: z.number().int(),
        streamId: z.number().int(),
        confirm: confirmSchema,
      },
      annotations: DESTRUCTIVE,
    },
    ({ channelId, streamId }) => run(`Unassigned stream ${streamId} from channel ${channelId}`, () => client.unassignStream(channelId, streamId)),
  );
};
