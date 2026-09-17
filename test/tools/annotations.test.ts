import { describe, expect, it } from 'vitest';
import { connect, mockClient } from '../helpers.js';

const DEFAULT_TOOL_COUNT = 24;
const DESTRUCTIVE_TOOLS = ['podium_backup', 'podium_reset_state'];

describe('tool annotations', () => {
  it('registers exactly the default tool set, all fully annotated', async () => {
    const mcp = await connect(mockClient());
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(DEFAULT_TOOL_COUNT);
    for (const t of tools) {
      const a = t.annotations;
      expect(a, t.name).toBeDefined();
      expect(typeof a!.readOnlyHint, t.name).toBe('boolean');
      expect(typeof a!.destructiveHint, t.name).toBe('boolean');
      expect(typeof a!.idempotentHint, t.name).toBe('boolean');
      // Every tool talks only to the configured Podium instance.
      expect(a!.openWorldHint, t.name).toBe(false);
    }
    for (const name of DESTRUCTIVE_TOOLS) {
      expect(tools.some((t) => t.name === name), name).toBe(false);
    }
    await mcp.close();
  });

  it('adds only the two destructive tools when the flag is on', async () => {
    const mcp = await connect(mockClient(), { enableDestructive: true });
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(DEFAULT_TOOL_COUNT + DESTRUCTIVE_TOOLS.length);
    for (const name of DESTRUCTIVE_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.annotations?.destructiveHint, name).toBe(true);
      expect(t!.annotations?.readOnlyHint, name).toBe(false);
      expect(t!.annotations?.openWorldHint, name).toBe(false);
    }
    await mcp.close();
  });
});
