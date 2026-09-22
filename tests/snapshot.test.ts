import { describe, expect, it } from 'vitest';
import { buildSnapshot, pageIsWorthHelpingWith } from '@/lib/snapshot';
import { LOREM, articleHtml } from './fixtures';

function render(html: string, title = 'Test page'): void {
  document.title = title;
  document.body.innerHTML = html;
}

function names(kind: string): string[] {
  return buildSnapshot()
    .outline.filter((e) => e.kind === kind)
    .map((e) => e.name);
}

describe('buildSnapshot — content extraction', () => {
  it('pulls the article, its title and its byline out of a document-shaped page', () => {
    render(articleHtml(Array.from({ length: 6 }, () => LOREM)), 'Cancelling — Example');

    const snapshot = buildSnapshot();

    expect(snapshot.content).not.toBeNull();
    // Readability takes the title from the tab, not from the <h1>.
    expect(snapshot.content!.title).toBe('Cancelling — Example');
    expect(snapshot.content!.byline).toBe('Ada Lovelace');
    expect(snapshot.content!.text).toContain('Readability needs a few hundred characters');
    expect(snapshot.content!.truncated).toBe(false);
  });

  it('returns null content — without throwing — when there is no article to find', () => {
    render('<div><button>Save</button><button>Cancel</button></div>', 'App');

    const snapshot = buildSnapshot();

    expect(snapshot.content).toBeNull();
    expect(snapshot.outline.length).toBeGreaterThan(0);
  });

  it('truncates long content in the middle, keeping both the head and the tail', () => {
    const filler = Array.from({ length: 120 }, (_, i) => `Paragraph ${i}. ${LOREM}`);
    render(articleHtml(['HEAD_MARKER_START. ' + LOREM, ...filler, 'TAIL_MARKER_END. ' + LOREM]));

    const { content } = buildSnapshot();

    expect(content).not.toBeNull();
    expect(content!.truncated).toBe(true);
    expect(content!.text).toContain('HEAD_MARKER_START');
    expect(content!.text).toContain('TAIL_MARKER_END');
    expect(content!.text).toMatch(/\[\.\.\. \d+ characters omitted \.\.\.\]/);
  });

  it('collapses runs of blank lines that Readability leaves behind', () => {
    const blanks = '\n\n\n\n\n';
    const paragraphs = Array.from({ length: 6 }, () => LOREM);
    render(`
      <main><article>
        <h1>Spaced out</h1>
        ${paragraphs.map((p) => `<p>${p}</p>`).join(blanks)}
      </article></main>
    `);

    // Guard against a vacuous assertion: the source really does contain them.
    expect(document.body.textContent).toMatch(/\n{3,}/);

    const { content } = buildSnapshot();
    expect(content).not.toBeNull();
    expect(content!.text).not.toMatch(/\n{3,}/);
  });
});

describe('buildSnapshot — outline', () => {
  it('lists headings, nav links, buttons and landmarks', () => {
    render(articleHtml([LOREM, LOREM]));

    const snapshot = buildSnapshot();

    expect(names('heading')).toEqual(
      expect.arrayContaining(['How to cancel your plan', 'Refunds']),
    );
    expect(names('link')).toEqual(expect.arrayContaining(['Home', 'Docs']));
    expect(names('button')).toContain('Contact support');
    expect(names('landmark')).toEqual(expect.arrayContaining(['Main', 'main']));

    const h1 = snapshot.outline.find((e) => e.name === 'How to cancel your plan');
    expect(h1!.level).toBe(1);
    expect(snapshot.outline.find((e) => e.name === 'Refunds')!.level).toBe(2);
    expect(h1!.ref).toMatch(/^e\d+$/);
  });

  it('reads an aria-level heading role as a heading', () => {
    render('<div role="heading" aria-level="3">Custom heading</div>');

    const entry = buildSnapshot().outline.find((e) => e.name === 'Custom heading');
    expect(entry!.kind).toBe('heading');
    expect(entry!.level).toBe(3);
  });

  it('marks only in-viewport elements as on screen', () => {
    render(`
      <button data-test-rect="10,30">Near the top</button>
      <button data-test-rect="5000,30">Far below the fold</button>
    `);

    const outline = buildSnapshot().outline;
    expect(outline.find((e) => e.name === 'Near the top')!.inViewport).toBe(true);
    expect(outline.find((e) => e.name === 'Far below the fold')!.inViewport).toBe(false);
  });

  it('skips elements that are not rendered', () => {
    // jsdom's cascade does not propagate `display` to descendants, so the
    // display:none case is asserted on the element itself; `visibility` does
    // inherit, which is what makes the subtree assertion meaningful.
    render(`
      <button style="display:none">Display none button</button>
      <div style="visibility:hidden"><button>Hidden subtree button</button></div>
      <button style="opacity:0">Transparent button</button>
      <button>Visible button</button>
    `);

    expect(names('button')).toEqual(['Visible button']);
  });

  it('skips elements with no accessible name at all', () => {
    render('<button></button><a href="/x"></a><button>Named</button>');

    expect(buildSnapshot().outline.map((e) => e.name)).toEqual(['Named']);
  });

  it('dedupes entries that share a kind and a name', () => {
    render(`
      <a href="/1">Learn more</a>
      <a href="/2">Learn more</a>
      <button>Learn more</button>
    `);

    const outline = buildSnapshot().outline;
    expect(outline.filter((e) => e.name === 'Learn more')).toHaveLength(2);
    expect(outline.map((e) => e.kind)).toEqual(['link', 'button']);
  });

  it('caps the outline and flags the truncation', () => {
    const buttons = Array.from({ length: 250 }, (_, i) => `<button>Action ${i}</button>`).join('');
    render(buttons);

    const snapshot = buildSnapshot();
    expect(snapshot.outline).toHaveLength(200);
    expect(snapshot.outlineTruncated).toBe(true);
  });

  it('does not flag truncation when everything fit', () => {
    render('<button>Only one</button>');
    expect(buildSnapshot().outlineTruncated).toBe(false);
  });
});

describe('buildSnapshot — accessible names', () => {
  it('prefers aria-label over everything else', () => {
    render(`
      <span id="labeller">Labelled by text</span>
      <button aria-label="Aria label" aria-labelledby="labeller">Inner text</button>
    `);

    expect(names('button')).toContain('Aria label');
  });

  it('falls back to aria-labelledby, joining several ids', () => {
    render(`
      <span id="one">Delete</span><span id="two">account</span>
      <button aria-labelledby="one two">x</button>
    `);

    expect(names('button')).toContain('Delete account');
  });

  it('prefers a real label over a placeholder for a field', () => {
    render(`
      <label for="email">Email address</label>
      <input id="email" name="email_name" placeholder="you@example.com" />
    `);

    expect(names('field')).toEqual(['Email address (text)']);
  });

  it('falls back to the placeholder, then to the name attribute', () => {
    render(`
      <input placeholder="Search orders" />
      <input name="raw_field_name" />
    `);

    expect(names('field')).toEqual(['Search orders (text)', 'raw_field_name (text)']);
  });

  it('uses text content when there is no aria or label information', () => {
    render('<a href="/pricing">See pricing</a>');
    expect(names('link')).toEqual(['See pricing']);
  });

  it('uses the title attribute as the last resort', () => {
    render('<button title="Close dialog"></button>');
    expect(names('button')).toEqual(['Close dialog']);
  });

  it('names a landmark from its role when it has no aria-label', () => {
    render('<div role="search"><input placeholder="q" /></div><nav><a href="/a">A</a></nav>');
    expect(names('landmark')).toEqual(expect.arrayContaining(['search', 'nav']));
  });
});

describe('buildSnapshot — field suffixes', () => {
  it('describes an input by type and state', () => {
    render(`
      <label for="e">Email address</label><input id="e" type="email" required />
      <label for="p">Phone</label><input id="p" type="tel" disabled />
    `);

    expect(names('field')).toEqual([
      'Email address (email, required)',
      'Phone (tel, disabled)',
    ]);
  });

  it('still lists a field that has no name at all, by its type alone', () => {
    render('<input type="email" required />');

    // The suffix is appended to an empty name, so the entry survives the
    // "no name, skip it" filter with the type as its only description.
    expect(names('field').map((n) => n.trim())).toEqual(['(email, required)']);
  });

  it('describes selects and textareas by tag', () => {
    render(`
      <label for="c">Country</label><select id="c" required><option>IT</option></select>
      <label for="n">Notes</label><textarea id="n" disabled></textarea>
    `);

    expect(names('field')).toEqual(['Country (select, required)', 'Notes (textarea, disabled)']);
  });

  it('classifies a submit input as a button, using its value as the name', () => {
    render('<input type="submit" value="Place order" />');

    const outline = buildSnapshot().outline;
    expect(outline.find((e) => e.name === 'Place order')!.kind).toBe('button');
  });
});

describe('buildSnapshot — meta', () => {
  it('reports the url, title, viewport and form count', () => {
    render('<form><input name="a" /></form><form><input name="b" /></form>', 'Two forms');

    const { meta } = buildSnapshot();
    expect(meta.url).toBe(location.href);
    expect(meta.title).toBe('Two forms');
    expect(meta.viewport).toEqual({ w: window.innerWidth, h: window.innerHeight });
    expect(meta.formCount).toBe(2);
    expect(meta.scrollPct).toBe(0);
  });
});

describe('pageIsWorthHelpingWith', () => {
  it('is true for a page with a real body of text', () => {
    render(`<p>${LOREM}</p>`);
    expect(pageIsWorthHelpingWith()).toBe(true);
  });

  it('is true for a short page that is dense with controls', () => {
    render('<button>a</button><button>b</button><input /><select></select><a href="/x">x</a>');
    expect(pageIsWorthHelpingWith()).toBe(true);
  });

  it('is false for an empty page', () => {
    render('');
    expect(pageIsWorthHelpingWith()).toBe(false);
  });

  it('is false for a bare redirect stub', () => {
    render('<p>Redirecting…</p><a href="/next">click here</a>');
    expect(pageIsWorthHelpingWith()).toBe(false);
  });
});
