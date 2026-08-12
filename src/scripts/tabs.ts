/**
 * Accessible tab-group behaviour (WAI-ARIA APG tabs pattern), shared by
 * every CommandTabs instance: click or Left/Right/Home/End moves selection;
 * only the selected panel is visible; roving tabindex.
 */

function activate(group: HTMLElement, tabId: string): void {
  const tabs = group.querySelectorAll<HTMLElement>('[role="tab"]');
  const panels = group.querySelectorAll<HTMLElement>('[data-tab-panel]');

  for (const tab of tabs) {
    const isSelected = tab.dataset.tabId === tabId;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
  }

  for (const panel of panels) {
    panel.hidden = panel.dataset.tabPanel !== tabId;
  }
}

function handleKeydown(event: KeyboardEvent, group: HTMLElement): void {
  const tabs = Array.from(group.querySelectorAll<HTMLElement>('[role="tab"]'));
  const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
  if (currentIndex === -1) return;

  let nextIndex: number | null = null;

  switch (event.key) {
    case 'ArrowRight':
      nextIndex = (currentIndex + 1) % tabs.length;
      break;
    case 'ArrowLeft':
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const next = tabs[nextIndex];
  const tabId = next.dataset.tabId;
  if (tabId) {
    activate(group, tabId);
    next.focus();
  }
}

export function initCommandTabs(root: ParentNode = document): void {
  const groups = root.querySelectorAll<HTMLElement>('[data-command-tabs]');
  for (const group of groups) {
    if (group.dataset.tabsInitialized === 'true') continue;
    group.dataset.tabsInitialized = 'true';

    group.addEventListener('click', (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
      if (!tab || !group.contains(tab)) return;
      const tabId = tab.dataset.tabId;
      if (tabId) activate(group, tabId);
    });

    group.addEventListener('keydown', (event) => handleKeydown(event as KeyboardEvent, group));
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initCommandTabs());
  } else {
    initCommandTabs();
  }
}
