/**
 * Element <-> ref-id registry.
 *
 * This is the seam for future page interaction. The snapshot stamps every
 * structural/interactive element with a short id (`e1`, `e2`, ...), the model
 * cites those ids back in `refs`, and a later action layer can resolve them to
 * live elements to scroll, highlight, or click — with no change to the snapshot
 * format or the prompt contract.
 *
 * Lives only in the content script, so it is naturally per-tab.
 */

const elementToRef = new WeakMap<Element, string>();
const refToElement = new Map<string, WeakRef<Element>>();
let counter = 0;

/** Stable id for an element, minted on first sight and reused thereafter. */
export function refFor(el: Element): string {
  const existing = elementToRef.get(el);
  if (existing !== undefined) return existing;

  const ref = `e${++counter}`;
  elementToRef.set(el, ref);
  refToElement.set(ref, new WeakRef(el));
  return ref;
}

/**
 * Resolve a ref back to a live element, or null if it was garbage collected or
 * detached from the document (SPAs re-render constantly — a stale ref is normal,
 * not an error).
 */
export function resolveRef(ref: string): Element | null {
  const el = refToElement.get(ref)?.deref();
  if (el === undefined) {
    refToElement.delete(ref);
    return null;
  }
  return el.isConnected ? el : null;
}

/** Drop entries whose elements are gone. Cheap; call after building a snapshot. */
export function pruneRefs(): void {
  for (const [ref, weak] of refToElement) {
    const el = weak.deref();
    if (el === undefined || !el.isConnected) refToElement.delete(ref);
  }
}

/** Test/debug helper — the number of refs currently tracked. */
export function refCount(): number {
  return refToElement.size;
}
