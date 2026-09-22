import { Readability } from '@mozilla/readability';
import { refFor, pruneRefs } from './refs';

export type OutlineKind = 'heading' | 'landmark' | 'link' | 'button' | 'field';

export interface OutlineEntry {
  ref: string;
  kind: OutlineKind;
  /** Heading level 1-6, only for kind === 'heading'. */
  level?: number;
  name: string;
  inViewport: boolean;
}

export interface PageSnapshot {
  meta: {
    url: string;
    title: string;
    viewport: { w: number; h: number };
    /** How far down the page the user currently is, 0-100. */
    scrollPct: number;
    formCount: number;
  };
  /** Readability's main-content extraction. `null` on app/dashboard pages. */
  content: {
    title: string;
    byline: string | null;
    excerpt: string | null;
    text: string;
    truncated: boolean;
  } | null;
  outline: OutlineEntry[];
  /** True when the outline hit its cap and some elements were dropped. */
  outlineTruncated: boolean;
}

const MAX_TEXT_CHARS = 12_000;
const MAX_OUTLINE_ENTRIES = 200;
const MAX_NAME_CHARS = 120;

const OUTLINE_SELECTOR = [
  'h1, h2, h3, h4, h5, h6',
  'nav, main, header, footer, aside, form',
  '[role]',
  'a[href]',
  'button, summary',
  'input, select, textarea',
  '[aria-label]',
].join(', ');

const LANDMARK_ROLES = new Set([
  'navigation',
  'main',
  'banner',
  'contentinfo',
  'search',
  'form',
  'complementary',
  'region',
]);

const LANDMARK_TAGS = new Set(['NAV', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'FORM']);
const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const BUTTONISH_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image']);

function squash(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS);
}

/**
 * Keep the head and the tail. Dense pages put the important controls and the
 * "what happens next" copy at the bottom — lopping off the tail is exactly the
 * wrong truncation for a navigation assistant.
 */
function truncateMiddle(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return {
    text: `${text.slice(0, head)}\n\n[... ${text.length - max} characters omitted ...]\n\n${text.slice(-tail)}`,
    truncated: true,
  };
}

function isRendered(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

function classify(el: Element): OutlineKind | null {
  const tag = el.tagName;
  const role = el.getAttribute('role')?.toLowerCase();

  if (/^H[1-6]$/.test(tag) || role === 'heading') return 'heading';

  if (tag === 'A' && el.hasAttribute('href')) return 'link';
  if (role === 'link') return 'link';

  if (tag === 'BUTTON' || tag === 'SUMMARY' || role === 'button') return 'button';
  if (tag === 'INPUT' && BUTTONISH_INPUT_TYPES.has((el as HTMLInputElement).type)) return 'button';

  if (FIELD_TAGS.has(tag)) return 'field';
  if (role === 'textbox' || role === 'combobox' || role === 'checkbox' || role === 'radio') {
    return 'field';
  }

  if (LANDMARK_TAGS.has(tag) || (role !== undefined && LANDMARK_ROLES.has(role))) {
    return 'landmark';
  }

  return null;
}

function landmarkName(el: Element): string {
  const explicit = squash(el.getAttribute('aria-label'));
  if (explicit) return explicit;
  const role = el.getAttribute('role');
  return squash(role ?? el.tagName.toLowerCase());
}

function accessibleName(el: Element, kind: OutlineKind): string {
  const aria = squash(el.getAttribute('aria-label'));
  if (aria) return aria;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => squash(document.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(' ');
    if (text) return squash(text);
  }

  if (kind === 'landmark') return landmarkName(el);

  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const fromLabel = squash(Array.from(el.labels ?? []).map((l) => l.textContent).join(' '));
    if (fromLabel) return fromLabel;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const placeholder = squash(el.placeholder);
      if (placeholder) return placeholder;
      if (el instanceof HTMLInputElement && el.value && BUTTONISH_INPUT_TYPES.has(el.type)) {
        return squash(el.value);
      }
    }
    const name = squash(el.getAttribute('name'));
    if (name) return name;
  }

  if (el instanceof HTMLImageElement) {
    const alt = squash(el.alt);
    if (alt) return alt;
  }

  // innerText respects rendering (hidden subtrees excluded) — worth the layout
  // cost here, and only ever read on small elements (headings, links, buttons).
  const text = squash((el as HTMLElement).innerText ?? el.textContent);
  if (text) return text;

  return squash(el.getAttribute('title'));
}

function fieldSuffix(el: Element): string {
  if (el instanceof HTMLInputElement) {
    const bits = [el.type];
    if (el.required) bits.push('required');
    if (el.disabled) bits.push('disabled');
    return ` (${bits.join(', ')})`;
  }
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const bits: string[] = [el.tagName.toLowerCase()];
    if (el.required) bits.push('required');
    if (el.disabled) bits.push('disabled');
    return ` (${bits.join(', ')})`;
  }
  return '';
}

function buildOutline(): { outline: OutlineEntry[]; truncated: boolean } {
  const outline: OutlineEntry[] = [];
  const seen = new Set<string>();
  const vh = window.innerHeight;
  let truncated = false;

  for (const el of Array.from(document.querySelectorAll(OUTLINE_SELECTOR))) {
    if (outline.length >= MAX_OUTLINE_ENTRIES) {
      truncated = true;
      break;
    }

    const kind = classify(el);
    if (kind === null) continue;
    if (!isRendered(el)) continue;

    let name = accessibleName(el, kind);
    if (kind === 'field') name += fieldSuffix(el);
    if (!name) continue;

    const dedupeKey = `${kind}|${name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rect = el.getBoundingClientRect();
    const entry: OutlineEntry = {
      ref: refFor(el),
      kind,
      name,
      inViewport: rect.top < vh && rect.bottom > 0,
    };

    if (kind === 'heading') {
      const fromTag = /^H([1-6])$/.exec(el.tagName)?.[1];
      const fromAria = el.getAttribute('aria-level');
      const level = Number(fromTag ?? fromAria);
      if (Number.isFinite(level) && level > 0) entry.level = level;
    }

    outline.push(entry);
  }

  return { outline, truncated };
}

function extractContent(): PageSnapshot['content'] {
  try {
    // Readability mutates the document it is given — the clone is mandatory.
    const clone = document.cloneNode(true) as Document;
    const article = new Readability(clone).parse();
    if (!article?.textContent) return null;

    // Readability leaves long runs of blank lines on app-like pages. They are
    // pure token cost and make the content block harder for the model to read.
    const collapsed = article.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    const { text, truncated } = truncateMiddle(collapsed, MAX_TEXT_CHARS);
    return {
      title: squash(article.title) || document.title,
      byline: squash(article.byline) || null,
      excerpt: squash(article.excerpt) || null,
      text,
      truncated,
    };
  } catch {
    // Readability throws on plenty of real pages. A missing article is an
    // expected outcome, not a failure — the outline still carries the page.
    return null;
  }
}

export function buildSnapshot(): PageSnapshot {
  const { outline, truncated: outlineTruncated } = buildOutline();
  pruneRefs();

  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const scrollPct = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 0;

  return {
    meta: {
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollPct: Math.min(100, Math.max(0, scrollPct)),
      formCount: document.forms.length,
    },
    content: extractContent(),
    outline,
    outlineTruncated,
  };
}

/** True when there is enough on the page to be worth offering help with. */
export function pageIsWorthHelpingWith(): boolean {
  const text = document.body?.innerText?.trim() ?? '';
  if (text.length > 200) return true;
  return document.querySelectorAll('a[href], button, input, select, textarea').length > 3;
}
