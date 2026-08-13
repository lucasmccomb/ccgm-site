/**
 * Page-level inline budget with a fill rule (§3.4, §5 E5, adrev2-016).
 *
 * A per-file threshold does not bound a page: commands-extra declares 114
 * files / 958 KB, of which only two exceed 64 KB -- trimming those two
 * alone would still leave ~800 KB inlined. File bodies are therefore
 * inlined in a deterministic order -- by type group (the real
 * FILE_TYPE_BUCKETS vocabulary), smallest-first within each group -- until
 * a 250 KB total-inlined-content budget is spent. Any single file over
 * 64 KB is never inlined regardless of remaining budget. Everything left
 * over renders as a bounded preview plus its rawUrl link on the caller
 * side; this module only decides which files make the cut.
 */
import { FILE_TYPE_BUCKETS, type ContentFile } from './schema.ts';

export const INLINE_BUDGET_BYTES = 250 * 1024;
export const MAX_INLINE_FILE_BYTES = 64 * 1024;

export interface InlineDecision {
  file: ContentFile;
  inlined: boolean;
}

export interface InlineBudgetResult {
  /** In the deterministic order the budget was applied -- NOT the caller's original array order. */
  items: InlineDecision[];
  totalInlinedBytes: number;
  /** Files left out for any reason: over the 64 KB per-file cap, or the 250 KB page budget was already spent. */
  remainderCount: number;
}

function typeGroupIndex(type: string): number {
  const index = (FILE_TYPE_BUCKETS as readonly string[]).indexOf(type);
  return index === -1 ? FILE_TYPE_BUCKETS.length : index; // unrecognized types sort last
}

/**
 * Deterministic candidate order: by type group (FILE_TYPE_BUCKETS order),
 * smallest-first within each group, path as the final tiebreaker so the
 * order is stable and reproducible across runs.
 */
export function orderCandidates(files: ContentFile[]): ContentFile[] {
  return [...files].sort((a, b) => {
    const groupDelta = typeGroupIndex(a.type) - typeGroupIndex(b.type);
    if (groupDelta !== 0) return groupDelta;
    if (a.bytes !== b.bytes) return a.bytes - b.bytes;
    return a.path.localeCompare(b.path);
  });
}

/** Apply the 250 KB page budget / 64 KB per-file cap to a set of contentFiles, in the deterministic order above. */
export function computeInlineBudget(
  files: ContentFile[],
  budgetBytes = INLINE_BUDGET_BYTES,
  maxFileBytes = MAX_INLINE_FILE_BYTES,
): InlineBudgetResult {
  const ordered = orderCandidates(files);
  let runningTotal = 0;
  const items: InlineDecision[] = [];

  for (const file of ordered) {
    if (file.bytes > maxFileBytes) {
      items.push({ file, inlined: false });
      continue;
    }
    if (runningTotal + file.bytes > budgetBytes) {
      items.push({ file, inlined: false });
      continue;
    }
    runningTotal += file.bytes;
    items.push({ file, inlined: true });
  }

  const remainderCount = items.filter((item) => !item.inlined).length;
  return { items, totalInlinedBytes: runningTotal, remainderCount };
}
