import { describe, expect, it } from 'vitest';
import { computeInlineBudget, orderCandidates, INLINE_BUDGET_BYTES, MAX_INLINE_FILE_BYTES } from '../../src/lib/inline-budget.ts';
import type { ContentFile } from '../../src/lib/schema.ts';

/**
 * Page-level inline budget with a fill rule (§3.4, §5 E5). Deep-checked
 * against real commands-extra/dreaming/autoheal numbers in e2e/modules.spec.ts;
 * this file pins the deterministic ordering and boundary conditions with
 * synthetic fixtures.
 */

function file(overrides: Partial<ContentFile> & Pick<ContentFile, 'path' | 'type' | 'bytes'>): ContentFile {
  return {
    content: 'x'.repeat(overrides.bytes),
    hasSubstitutionPlaceholders: false,
    isMergeFragment: false,
    rawUrl: `/modules/fixture/files/${overrides.path}.txt`,
    ...overrides,
  };
}

describe('orderCandidates', () => {
  it('orders by type group (FILE_TYPE_BUCKETS order), then smallest-first within a group, then path', () => {
    const files: ContentFile[] = [
      file({ path: 'b.sh', type: 'script', bytes: 100 }),
      file({ path: 'a.md', type: 'rule', bytes: 50 }),
      file({ path: 'c.md', type: 'rule', bytes: 10 }),
      file({ path: 'a.sh', type: 'script', bytes: 100 }),
    ];

    const ordered = orderCandidates(files).map((f) => f.path);
    // rule group before script group; within rule, 10 bytes before 50; within
    // script, equal bytes tiebreak alphabetically by path.
    expect(ordered).toEqual(['c.md', 'a.md', 'a.sh', 'b.sh']);
  });

  it('sorts an unrecognized type after every known type', () => {
    const files: ContentFile[] = [
      file({ path: 'weird.xyz', type: 'made-up-type', bytes: 1 }),
      file({ path: 'other.txt', type: 'other', bytes: 1 }),
      file({ path: 'z.md', type: 'rule', bytes: 1 }),
    ];

    const ordered = orderCandidates(files).map((f) => f.path);
    expect(ordered[0]).toBe('z.md');
    // 'other' is a real bucket (last known one); an actually-unrecognized
    // type sorts after even that.
    expect(ordered[ordered.length - 1]).toBe('weird.xyz');
  });
});

describe('computeInlineBudget', () => {
  it('inlines everything when total bytes stay under the budget', () => {
    const files: ContentFile[] = [
      file({ path: 'a.md', type: 'rule', bytes: 100 }),
      file({ path: 'b.md', type: 'doc', bytes: 200 }),
    ];

    const result = computeInlineBudget(files);
    expect(result.remainderCount).toBe(0);
    expect(result.totalInlinedBytes).toBe(300);
    expect(result.items.every((item) => item.inlined)).toBe(true);
  });

  it('never inlines a file over the 64 KB per-file cap, regardless of remaining budget', () => {
    const files: ContentFile[] = [file({ path: 'huge.py', type: 'lib', bytes: MAX_INLINE_FILE_BYTES + 1 })];

    const result = computeInlineBudget(files);
    expect(result.remainderCount).toBe(1);
    expect(result.totalInlinedBytes).toBe(0);
    expect(result.items[0].inlined).toBe(false);
  });

  it('inlines a file exactly at the 64 KB cap', () => {
    const files: ContentFile[] = [file({ path: 'exact.py', type: 'lib', bytes: MAX_INLINE_FILE_BYTES })];
    const result = computeInlineBudget(files);
    expect(result.items[0].inlined).toBe(true);
  });

  it('skips a file that would exceed the budget but keeps trying later (smaller) files -- bin-packing fill, not stop-on-first-miss', () => {
    // Every file individually respects the 64 KB per-file cap.
    const files: ContentFile[] = [
      file({ path: 'rule-1.md', type: 'rule', bytes: 62_000 }),
      file({ path: 'rule-2.md', type: 'rule', bytes: 62_000 }),
      file({ path: 'rule-3.md', type: 'rule', bytes: 62_000 }),
      file({ path: 'rule-4.md', type: 'rule', bytes: 62_000 }), // running = 248,000; 8,000 left in the budget
      file({ path: 'b.md', type: 'doc', bytes: 10_000 }), // 258,000 > budget -- skipped, running stays 248,000
      file({ path: 'c.md', type: 'other', bytes: 5_000 }), // 253,000 <= budget -- still fits past the skip
    ];

    const result = computeInlineBudget(files);
    const byPath = new Map(result.items.map((item) => [item.file.path, item.inlined]));
    expect(byPath.get('rule-1.md')).toBe(true);
    expect(byPath.get('b.md')).toBe(false);
    expect(byPath.get('c.md')).toBe(true);
    expect(result.totalInlinedBytes).toBe(253_000);
    expect(result.remainderCount).toBe(1);
  });

  it('inlines a set of files that lands exactly on the 250 KB budget boundary', () => {
    // Every file individually respects the 64 KB per-file cap; together they
    // sum to exactly INLINE_BUDGET_BYTES.
    const files: ContentFile[] = [
      file({ path: 'a.md', type: 'rule', bytes: MAX_INLINE_FILE_BYTES }),
      file({ path: 'b.md', type: 'rule', bytes: MAX_INLINE_FILE_BYTES }),
      file({ path: 'c.md', type: 'rule', bytes: MAX_INLINE_FILE_BYTES }),
      file({ path: 'd.md', type: 'rule', bytes: INLINE_BUDGET_BYTES - 3 * MAX_INLINE_FILE_BYTES }),
    ];

    const result = computeInlineBudget(files);
    expect(result.items.every((item) => item.inlined)).toBe(true);
    expect(result.totalInlinedBytes).toBe(INLINE_BUDGET_BYTES);
  });

  it('respects custom budget/cap parameters for isolated boundary testing', () => {
    const files: ContentFile[] = [
      file({ path: 'a.md', type: 'rule', bytes: 50 }),
      file({ path: 'b.md', type: 'rule', bytes: 60 }),
    ];

    const result = computeInlineBudget(files, 100, 55);
    // b.md exceeds the custom 55-byte per-file cap; a.md fits the 100-byte budget alone.
    const byPath = new Map(result.items.map((item) => [item.file.path, item.inlined]));
    expect(byPath.get('a.md')).toBe(true);
    expect(byPath.get('b.md')).toBe(false);
  });
});
