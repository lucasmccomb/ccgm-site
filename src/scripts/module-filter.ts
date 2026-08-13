/**
 * Progressive-enhancement tag filter for the module catalog (§5 E5).
 *
 * Without this script: every module card is visible, grouped into its
 * category section -- a complete, working plain list, chips included (they
 * render, but clicking them does nothing until this script runs).
 *
 * With it: clicking a tag chip toggles that tag into an active filter set;
 * a card is hidden unless it carries at least one active tag (OR across
 * active tags -- "show me anything tagged X or Y"). No active tags means
 * everything is visible again. A category section with no visible cards
 * hides itself; an empty-state message shows only when no card anywhere
 * is visible.
 */

function getActiveTags(chips: HTMLElement[]): Set<string> {
  const active = new Set<string>();
  for (const chip of chips) {
    if (chip.getAttribute('aria-pressed') === 'true' && chip.dataset.tag) {
      active.add(chip.dataset.tag);
    }
  }
  return active;
}

function applyFilter(activeTags: Set<string>): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-module-card]');
  for (const card of cards) {
    const cardTags = (card.dataset.tags ?? '').split(',').filter(Boolean);
    const visible = activeTags.size === 0 || cardTags.some((tag) => activeTags.has(tag));
    card.hidden = !visible;
  }

  const sections = document.querySelectorAll<HTMLElement>('[data-category-section]');
  let anyCardVisible = false;
  for (const section of sections) {
    const sectionCards = section.querySelectorAll<HTMLElement>('[data-module-card]');
    const sectionHasVisibleCard = [...sectionCards].some((card) => !card.hidden);
    section.hidden = !sectionHasVisibleCard;
    anyCardVisible = anyCardVisible || sectionHasVisibleCard;
  }

  const emptyState = document.querySelector<HTMLElement>('[data-catalog-empty]');
  if (emptyState) emptyState.hidden = anyCardVisible;
}

export function initModuleFilter(): void {
  const container = document.querySelector<HTMLElement>('[data-tag-filter]');
  if (!container || container.dataset.filterInitialized === 'true') return;
  container.dataset.filterInitialized = 'true';

  const chips = [...container.querySelectorAll<HTMLElement>('[data-tag-chip]')];

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const pressed = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', pressed ? 'false' : 'true');
      applyFilter(getActiveTags(chips));
    });
  }

  const clearButton = document.querySelector<HTMLElement>('[data-tag-filter-clear]');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      for (const chip of chips) chip.setAttribute('aria-pressed', 'false');
      applyFilter(new Set());
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initModuleFilter());
  } else {
    initModuleFilter();
  }
}
