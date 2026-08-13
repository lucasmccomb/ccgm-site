/**
 * Header search island's client behavior (§5 E6). Progressive enhancement
 * over Search.astro's plain <input type="search">: without this script the
 * input renders and does nothing, which is a complete, harmless page --
 * category browse (E5's /modules catalog) remains the primary discovery
 * surface (§5 E6 scope).
 *
 * The Pagefind bundle (`/pagefind/pagefind.js`, emitted by `pagefind --site
 * dist` in the build script) is lazy-loaded on the input's first focus or
 * keystroke, never eagerly -- it does not exist at all in an unbuilt `astro
 * dev` session, and loading it up front would cost every page a WASM fetch
 * nobody asked for yet.
 *
 * `/* @vite-ignore *``/` on the dynamic import: this path is a build-time
 * generated asset that does not exist in the source tree, so Vite must not
 * try to statically resolve or pre-bundle it.
 */
import { sanitizeExcerptHtml } from '../lib/search-sanitize.ts';

interface PagefindResultData {
  url: string;
  excerpt: string;
  meta?: { title?: string };
}

interface PagefindResultRef {
  id: string;
  data: () => Promise<PagefindResultData>;
}

interface PagefindSearchResponse {
  results: PagefindResultRef[];
}

interface PagefindModule {
  init: () => Promise<void>;
  search: (term: string) => Promise<PagefindSearchResponse>;
}

const DEBOUNCE_MS = 150;
const MAX_RESULTS = 8;
const PAGEFIND_URL = '/pagefind/pagefind.js';

let pagefindPromise: Promise<PagefindModule> | null = null;

function loadPagefind(): Promise<PagefindModule> {
  if (!pagefindPromise) {
    pagefindPromise = import(/* @vite-ignore */ PAGEFIND_URL).then(async (mod) => {
      const pagefind = mod as PagefindModule;
      await pagefind.init();
      return pagefind;
    });
  }
  return pagefindPromise;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

interface RenderedResult {
  url: string;
  title: string;
  excerptHtml: string;
}

function renderResults(
  list: HTMLElement,
  status: HTMLElement,
  results: RenderedResult[],
  query: string,
): void {
  list.textContent = '';

  if (results.length === 0) {
    list.hidden = true;
    status.textContent = query ? `No results for "${query}"` : '';
    return;
  }

  for (const result of results) {
    const item = document.createElement('li');
    item.className = 'site-search__result';
    item.setAttribute('data-search-result', '');
    item.setAttribute('data-search-result-url', result.url);

    const link = document.createElement('a');
    link.href = result.url;
    link.textContent = result.title;
    link.setAttribute('data-search-result-link', '');
    item.appendChild(link);

    const excerpt = document.createElement('p');
    excerpt.className = 'site-search__excerpt';
    excerpt.setAttribute('data-search-result-excerpt', '');
    // Safe by construction: sanitizeExcerptHtml only ever lets a bare,
    // attribute-free <mark>/</mark> pair survive -- everything else in the
    // excerpt, including any tag pulled from indexed page content, is
    // HTML-escaped first (src/lib/search-sanitize.ts).
    excerpt.innerHTML = result.excerptHtml;
    item.appendChild(excerpt);

    list.appendChild(item);
  }

  list.hidden = false;
  status.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`;
}

async function runSearch(query: string, list: HTMLElement, status: HTMLElement): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    list.hidden = true;
    list.textContent = '';
    status.textContent = '';
    return;
  }

  let pagefind: PagefindModule;
  try {
    pagefind = await loadPagefind();
  } catch {
    status.textContent = 'Search is unavailable.';
    return;
  }

  const { results: refs } = await pagefind.search(trimmed);
  const top = refs.slice(0, MAX_RESULTS);
  const dataResults = await Promise.all(top.map((ref) => ref.data()));

  const rendered: RenderedResult[] = dataResults.map((data) => ({
    url: data.url,
    title: data.meta?.title ?? data.url,
    excerptHtml: sanitizeExcerptHtml(data.excerpt),
  }));

  renderResults(list, status, rendered, trimmed);
}

export function initSearch(): void {
  const root = document.querySelector<HTMLElement>('[data-search]');
  if (!root || root.dataset.searchInitialized === 'true') return;
  root.dataset.searchInitialized = 'true';

  const input = root.querySelector<HTMLInputElement>('[data-search-input]');
  const list = root.querySelector<HTMLElement>('[data-search-results]');
  const status = root.querySelector<HTMLElement>('[data-search-status]');
  if (!input || !list || !status) return;

  let debounceHandle: number | undefined;
  let pagefindLoadTriggered = false;

  const ensureLoaded = (): void => {
    if (pagefindLoadTriggered) return;
    pagefindLoadTriggered = true;
    void loadPagefind();
  };

  input.addEventListener('focus', ensureLoaded);

  input.addEventListener('input', () => {
    ensureLoaded();
    window.clearTimeout(debounceHandle);
    const query = input.value;
    debounceHandle = window.setTimeout(() => {
      void runSearch(query, list, status);
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    input.value = '';
    list.hidden = true;
    list.textContent = '';
    status.textContent = '';
  });

  // Global "/" shortcut (§5 E6): ignored while focus is already on an
  // editable element, and while a modifier key is held, so it never steals
  // a literal "/" a user is typing somewhere else.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    input.focus();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initSearch());
  } else {
    initSearch();
  }
}
