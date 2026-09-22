import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `lib/refs.ts` holds module-level state (the counter and the ref map), so each
 * test re-imports it fresh rather than inheriting the previous test's ids.
 */
async function freshRefs() {
  vi.resetModules();
  return import('@/lib/refs');
}

describe('refs registry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mints one stable id per element and reuses it', async () => {
    const { refFor } = await freshRefs();
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;

    const first = refFor(a);
    expect(refFor(a)).toBe(first);
    expect(refFor(b)).not.toBe(first);
  });

  it('resolves a ref back to the live element', async () => {
    const { refFor, resolveRef } = await freshRefs();
    document.body.innerHTML = '<a href="/x" id="link">x</a>';
    const el = document.getElementById('link')!;

    expect(resolveRef(refFor(el))).toBe(el);
  });

  it('returns null for an unknown ref', async () => {
    const { resolveRef } = await freshRefs();
    expect(resolveRef('e999')).toBeNull();
  });

  it('returns null once the element is detached from the document', async () => {
    const { refFor, resolveRef } = await freshRefs();
    document.body.innerHTML = '<button id="gone">gone</button>';
    const el = document.getElementById('gone')!;
    const ref = refFor(el);

    el.remove();
    expect(resolveRef(ref)).toBeNull();
  });

  it('pruneRefs drops detached entries and keeps connected ones', async () => {
    const { refFor, pruneRefs, refCount } = await freshRefs();
    document.body.innerHTML = '<button id="keep">k</button><button id="drop">d</button>';
    const keep = document.getElementById('keep')!;
    const drop = document.getElementById('drop')!;
    refFor(keep);
    refFor(drop);
    expect(refCount()).toBe(2);

    drop.remove();
    pruneRefs();
    expect(refCount()).toBe(1);
  });
});
