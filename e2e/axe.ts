import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * The single axe configuration every a11y sweep in this suite runs.
 *
 * Not a `.spec.ts`, so Playwright's default testMatch never collects it as
 * a test file -- it is imported by the specs that scan a page.
 *
 * `target-size` (WCAG 2.2 SC 2.5.8) ships `enabled: false` in axe-core, so
 * a bare `new AxeBuilder({ page }).analyze()` silently skips it. The
 * project's stated bar is "zero critical/serious violations", not "zero
 * among the rules axe happens to enable by default", and a theme that
 * collapses a control below 24px is exactly the regression that bar exists
 * to catch (#21: the mono tag chips did, and CI stayed green). Enabling it
 * in one shared place is what keeps the next theme from repeating it.
 */
function build(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).options({
    rules: { 'target-size': { enabled: true } },
  });
}

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

/**
 * Scan the current page and return only the violations the suite treats as
 * failures. Callers assert `toEqual([])` on the result and pass it as the
 * failure message, so a red run names the offending nodes.
 */
export async function seriousOrCriticalViolations(page: Page): Promise<Violation[]> {
  const results = await build(page).analyze();
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}
