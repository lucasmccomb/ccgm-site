import { describe, expect, it } from 'vitest';
import { buildBanner } from '../../scripts/ascii-banner.ts';

describe('buildBanner', () => {
  it('is deterministic -- two calls return identical output', () => {
    expect(buildBanner()).toBe(buildBanner());
  });

  it('pins a stable shape -- exact line count and first line content', () => {
    const lines = buildBanner().split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(' ██████╗ ██████╗ ██████╗ ███╗   ███╗');
  });
});
