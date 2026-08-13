/**
 * Copy-to-clipboard logic shared by every CopyButton instance.
 *
 * Contract (E1 acceptance criteria):
 *  - copies the exact textContent of the button's target element, OR (§5
 *    E5) fetches data-copy-source and copies its response body verbatim
 *    when no local target element carries the full content
 *  - the "copied" state is only shown after the copy actually resolves
 *  - a rejected promise or failed fetch shows an inline error state instead
 *  - fully keyboard operable (native <button>, no custom key handling needed)
 */

const COPIED_LABEL_ATTR = 'data-copied-label';
const ERROR_LABEL_ATTR = 'data-error-label';
const IDLE_LABEL_ATTR = 'data-idle-label';
const RESET_DELAY_MS = 2000;

function getTarget(button: HTMLElement): HTMLElement | null {
  const targetId = button.getAttribute('data-copy-target');
  if (!targetId) return null;
  return document.getElementById(targetId);
}

/** Resolve the text to copy: local DOM target (synchronous) or a fetched remote source (§5 E5). */
async function resolveText(button: HTMLElement): Promise<string> {
  const sourceUrl = button.getAttribute('data-copy-source');
  if (sourceUrl) {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`fetch ${sourceUrl} failed: ${response.status}`);
    }
    return response.text();
  }

  const target = getTarget(button);
  return target?.textContent ?? '';
}

function getLiveRegion(button: HTMLElement): HTMLElement | null {
  const liveId = button.getAttribute('data-copy-live');
  if (!liveId) return null;
  return document.getElementById(liveId);
}

function setState(button: HTMLElement, state: 'idle' | 'copied' | 'error'): void {
  const labelEl = button.querySelector('[data-copy-label]');
  const idle = button.getAttribute(IDLE_LABEL_ATTR) ?? 'Copy';
  const copied = button.getAttribute(COPIED_LABEL_ATTR) ?? 'Copied';
  const error = button.getAttribute(ERROR_LABEL_ATTR) ?? 'Copy failed';

  button.setAttribute('data-state', state);

  if (labelEl) {
    labelEl.textContent = state === 'copied' ? copied : state === 'error' ? error : idle;
  }

  const live = getLiveRegion(button);
  if (live && state !== 'idle') {
    live.textContent = state === 'copied' ? copied : error;
  }
}

async function handleClick(event: Event): Promise<void> {
  const button = event.currentTarget as HTMLElement;
  const sourceUrl = button.getAttribute('data-copy-source');

  let text: string;
  if (sourceUrl) {
    // Remote-source mode (§5 E5): a failed fetch is a real, user-visible
    // failure -- show the error state rather than silently doing nothing.
    try {
      text = await resolveText(button);
    } catch {
      setState(button, 'error');
      window.setTimeout(() => setState(button, 'idle'), RESET_DELAY_MS);
      return;
    }
  } else {
    // Local-target mode (unchanged): a missing target element means the
    // button is misconfigured at build time, not a runtime failure -- stay
    // silent, matching the original contract.
    const target = getTarget(button);
    if (!target) return;
    text = target.textContent ?? '';
  }

  try {
    await navigator.clipboard.writeText(text);
    setState(button, 'copied');
  } catch {
    setState(button, 'error');
  }

  window.setTimeout(() => setState(button, 'idle'), RESET_DELAY_MS);
}

export function initCopyButtons(root: ParentNode = document): void {
  const buttons = root.querySelectorAll<HTMLElement>('[data-copy-button]');
  for (const button of buttons) {
    if (button.dataset.copyInitialized === 'true') continue;
    button.dataset.copyInitialized = 'true';
    button.addEventListener('click', handleClick);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initCopyButtons());
  } else {
    initCopyButtons();
  }
}
