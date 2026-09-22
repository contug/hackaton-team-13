/**
 * The first thing in this extension that writes to the host page.
 *
 * Every other module reads: the snapshot measures, the spotlight paints inside
 * our own shadow root, and until now there was not a single `.value =` or
 * `dispatchEvent` aimed at a host element anywhere in the codebase. This module
 * breaks that, and it is only acceptable because it is **user-initiated**: it
 * runs when the user presses "Fill this in" in our tooltip, which is exactly
 * the confirmation gate the action layer was always going to need. Nothing here
 * is ever called automatically, and no caller should make it so.
 */

/**
 * - `filled` — the value is in and the page has been told.
 * - `blocked` — a field we refuse to type into on principle (see `BLOCKED_*`).
 * - `unsupported` — a field with no `.value` we can set honestly.
 * - `missing` — there is no element; the ref went stale.
 */
export type FillOutcome = 'filled' | 'blocked' | 'unsupported' | 'missing';

/**
 * Putting model-generated text into a payment or one-time-code field is not a
 * feature. `password` is refused for the obvious reason, `hidden` and `file`
 * because a fill there is invisible or impossible.
 */
const BLOCKED_INPUT_TYPES = new Set(['password', 'hidden', 'file']);

const BLOCKED_AUTOCOMPLETE = new Set(['cc-number', 'cc-csc', 'cc-exp', 'one-time-code']);

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Narrowed on `instanceof`, deliberately not on the snapshot's `kind`.
 * `lib/snapshot.ts` classifies `role="textbox"` and `role="combobox"` elements
 * as `kind: 'field'` too — which is right for describing the page, and wrong
 * here: a `contenteditable` div with `role="textbox"` has no `.value` at all.
 */
function asFillable(el: Element | null): Fillable | null {
  if (el instanceof HTMLInputElement) return el;
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLSelectElement) return el;
  return null;
}

function isBlocked(el: Fillable): boolean {
  if (el.disabled) return true;
  if (el instanceof HTMLSelectElement) return false;
  if (el.readOnly) return true;
  if (el instanceof HTMLInputElement && BLOCKED_INPUT_TYPES.has(el.type.toLowerCase())) return true;

  // `autocomplete` is a token list: `cc-number` can arrive as
  // "section-card shipping cc-number".
  const tokens = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  return tokens.some((token) => BLOCKED_AUTOCOMPLETE.has(token));
}

/**
 * Whether the tooltip should offer a "Fill this in" button at all. Same rules
 * as `fillField`, asked before the fact so we never show a button that would
 * come back `blocked` or `unsupported`.
 */
export function canFill(el: Element | null): boolean {
  const field = asFillable(el);
  return field !== null && !isBlocked(field);
}

/**
 * The prototype's native `value` setter, not `el.value = text`.
 *
 * React installs its own `value` property directly on the element instance, so
 * a plain assignment writes to React's shadowed property and the site's state
 * never hears about it — the box looks filled and the app disagrees. Going
 * through the prototype descriptor writes where the browser expects, and the
 * `input`/`change` events below are what tell the framework. This exact failure
 * turned up while driving this project's own harness by hand.
 */
function setNativeValue(el: Fillable, value: string): void {
  const proto =
    el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
    return;
  }
  // No descriptor to borrow (an exotic engine): a plain assignment is strictly
  // better than doing nothing, even if a framework may miss it.
  el.value = value;
}

/** Match an option by value, then by visible label — case-insensitively. */
function optionValueFor(el: HTMLSelectElement, text: string): string | null {
  const wanted = text.trim().toLowerCase();
  for (const option of Array.from(el.options)) {
    if (option.value.trim().toLowerCase() === wanted) return option.value;
  }
  for (const option of Array.from(el.options)) {
    if ((option.textContent ?? '').trim().toLowerCase() === wanted) return option.value;
  }
  return null;
}

export function fillField(el: Element | null, text: string): FillOutcome {
  if (el === null) return 'missing';

  const field = asFillable(el);
  // A `contenteditable` search box lands here: classified as a field by the
  // snapshot, but with no `.value` to set. The step falls back to "do it
  // yourself" rather than pretending.
  if (field === null) return 'unsupported';
  if (isBlocked(field)) return 'blocked';

  let value = text;
  if (field instanceof HTMLSelectElement) {
    const match = optionValueFor(field, text);
    // No option matches: reporting `unsupported` beats selecting the wrong one.
    if (match === null) return 'unsupported';
    value = match;
  }

  // Focus first: a site listening for focus to open a suggestion dropdown has
  // to see it before the value lands, or its list is built from the old value.
  field.focus?.();
  setNativeValue(field, value);

  // Both events, bubbling: frameworks listen for `input`, plain-DOM sites and
  // `<select>`s tend to listen for `change`.
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));

  return 'filled';
}
