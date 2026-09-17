import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PodiumError } from '../podium/errors.js';

function asStructured(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data };
}

export function ok(data: unknown, summary: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: asStructured(data),
  };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export async function run(
  summary: string | ((data: unknown) => string),
  fn: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const data = await fn();
    return ok(data, typeof summary === 'function' ? summary(data) : summary);
  } catch (err) {
    if (err instanceof PodiumError) return fail(err.message);
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export const CONFIRM_DESCRIPTION =
  'Must be exactly true. This action changes live state. Ask the user for explicit confirmation before calling with confirm=true.';

export const confirmSchema = z.literal(true, { error: 'confirm must be exactly true' }).describe(CONFIRM_DESCRIPTION);
