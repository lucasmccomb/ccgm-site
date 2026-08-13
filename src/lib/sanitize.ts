/**
 * Unicode sanitization for every string that reaches a copy surface (§3.3).
 *
 * Strips zero-width characters (U+200B-U+200D, U+FEFF) and bidirectional
 * control characters (U+202A-U+202E, U+2066-U+2069). Verified against the
 * real ccgm repo today this is a no-op -- zero declared files or module
 * READMEs contain any of these code points -- but the transform (and the
 * sanitizedFiles[] record of every hit) is what keeps that fact true rather
 * than assumed, and is what makes a future divergence visible instead of
 * silently shipped.
 */

const SANITIZED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x200b, 0x200d], // zero-width space/non-joiner/joiner
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
  [0x202a, 0x202e], // bidi embedding/override controls
  [0x2066, 0x2069], // bidi isolate controls
];

function isSanitizedCodepoint(codePoint: number): boolean {
  return SANITIZED_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

function formatCodepoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

export interface SanitizeResult {
  /** The input with every zero-width/bidi control character removed. */
  text: string;
  /** Distinct codepoints found and stripped, sorted, e.g. ["U+200B"]. Empty when the input was already clean. */
  codepoints: string[];
}

/** Strip zero-width and bidirectional control characters, recording which ones were found. */
export function sanitizeText(input: string): SanitizeResult {
  const found = new Set<string>();
  let sawAny = false;
  const out: string[] = [];

  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && isSanitizedCodepoint(codePoint)) {
      found.add(formatCodepoint(codePoint));
      sawAny = true;
      continue;
    }
    out.push(char);
  }

  return {
    text: sawAny ? out.join('') : input,
    codepoints: Array.from(found).sort(),
  };
}
