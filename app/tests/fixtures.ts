import type { PageSnapshot } from '@/lib/snapshot';

/** A minimal, valid snapshot. Override only what a test is actually about. */
export function snapshotFixture(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    meta: {
      url: 'https://example.com/pricing',
      title: 'Pricing — Example',
      viewport: { w: 1280, h: 800 },
      scrollPct: 0,
      formCount: 1,
      ...over.meta,
    },
    content: over.content ?? null,
    outline: over.outline ?? [
      { ref: 'e1', kind: 'heading', level: 1, name: 'Pricing', inViewport: true },
      { ref: 'e2', kind: 'button', name: 'Upgrade', inViewport: false },
    ],
    outlineTruncated: over.outlineTruncated ?? false,
  };
}

/** A paragraph long enough that Readability treats it as real content. */
export const LOREM =
  'Readability needs a few hundred characters of prose before it will treat a ' +
  'node as the main content of a document, so each paragraph here is padded out ' +
  'to a realistic length with ordinary sentences that carry no meaning at all.';

/** A document Readability will happily parse: title, byline, and long prose. */
export function articleHtml(paragraphs: string[]): string {
  return `
    <header><nav aria-label="Main"><a href="/home">Home</a><a href="/docs">Docs</a></nav></header>
    <main>
      <article>
        <h1>How to cancel your plan</h1>
        <p class="author">Ada Lovelace</p>
        ${paragraphs.map((text) => `<p>${text}</p>`).join('\n')}
        <h2>Refunds</h2>
        <p>${LOREM}</p>
      </article>
    </main>
    <footer><button type="button">Contact support</button></footer>
  `;
}
