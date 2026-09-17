import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PodiumError } from '../podium/errors.js';

function asStructured(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data };
}

/**
 * Longest JSON text copied into the `content` block. Past this the text is truncated and the
 * caller is pointed at `structuredContent`, which always holds the complete payload.
 */
export const MAX_TEXT_BYTES = 100_000;

export function ok(data: unknown, summary: string): CallToolResult {
  // JSON.stringify returns undefined for undefined; keep the text a string either way.
  const json = JSON.stringify(data) ?? 'null';
  const text =
    json.length > MAX_TEXT_BYTES
      ? `${json.slice(0, MAX_TEXT_BYTES)}\n…[truncated: ${json.length - MAX_TEXT_BYTES} more characters; full payload is in structuredContent]`
      : json;
  return {
    content: [{ type: 'text', text: `${summary}\n${text}` }],
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
