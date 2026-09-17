import { z } from 'zod';
import type { ToolRegistrar } from '../server.js';
import type { OrderingRequest, OrderingWeights } from '../podium/types.js';
import { fail, run } from './result.js';

const weightsSchema = z
  .object({
    resolution: z.number().optional(),
    bitrate: z.number().optional(),
    fps: z.number().optional(),
    codec: z.number().optional(),
    audio: z.number().optional(),
    hdr: z.number().optional(),
    preferH265: z.boolean().optional(),
    hdrPreference: z.string().optional(),
    hevcBitrateFactor: z.number().optional(),
    uhdBitrateKbps: z.number().optional(),
  })
  .optional();

export const registerOrderingTools: ToolRegistrar = (server, { client }) => {
  server.registerTool(
    'podium_set_ordering',
    {
      title: 'Set ordering config',
      description: 'Update ordering mode, provider preference and/or quality weights. Read the current values with podium_get_ordering first. At least one field is required.',
      inputSchema: {
        mode: z.string().optional(),
        providerPreference: z.array(z.string()).optional(),
        weights: weightsSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ mode, providerPreference, weights }) => {
      const body: OrderingRequest = {};
      if (mode !== undefined) body.mode = mode;
      if (providerPreference !== undefined) body.providerPreference = providerPreference;
      if (weights !== undefined) {
        body.weights = Object.fromEntries(Object.entries(weights).filter(([, v]) => v !== undefined)) as OrderingWeights;
      }
      if (Object.keys(body).length === 0) return fail('Provide at least one of mode, providerPreference, weights');
      return run('Updated ordering configuration', () => client.setOrdering(body));
    },
  );
};
