import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../.output/chrome-mv3');

/**
 * This closes the gap open since the 12:37 entry in `claude-changelog.md`:
 * "the panel actually renders on a real page" had never been verified by
 * anything repeatable.
 *
 * The earlier attempt almost certainly failed on the browser channel. Chrome
 * and Edge removed `--load-extension`, so an unpacked extension only loads in
 * the Chromium bundled with Playwright, via a persistent context.
 */
let context: BrowserContext;

test.beforeAll(async () => {
  expect(
    existsSync(out),
    'Run `npx wxt build` first — this test loads the real build, not the source.',
  ).toBe(true);

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('the extension loads and its service worker starts', async () => {
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

  expect(worker.url()).toContain('chrome-extension://');
  expect(worker.url()).toContain('background');
});

test('the content script injects its shadow host into an ordinary page', async () => {
  const page = await context.newPage();
  await page.goto('http://localhost:5200/plain.html');

  // The custom element WXT mounts. If this is absent the content script never
  // ran, which is exactly the failure that went unexplained before.
  const host = page.locator('page-guide-ui');
  await expect(host).toHaveCount(1);

  // Playwright's CSS engine pierces open shadow roots on its own, so these
  // selectors reach inside `page-guide-ui` without any special syntax.
  const fab = page.locator('button[aria-label="Open Page Guide"]');
  await expect(fab).toBeVisible();

  const box = await fab.boundingBox();
  expect(box?.width).toBe(48);
  expect(box?.height).toBe(48);

  await page.close();
});

test('the panel opens inside the shadow root and asks for a key first', async () => {
  const page = await context.newPage();
  await page.goto('http://localhost:5200/plain.html');

  await page.locator('button[aria-label="Open Page Guide"]').click();

  await expect(page.locator('[role="dialog"]')).toBeVisible();
  // No key is stored in a fresh profile, so this is the setup view — and
  // nothing should have been sent to OpenRouter to find that out.
  await expect(
    page.locator('label:has-text("OpenRouter API key")'),
  ).toBeVisible();

  await page.close();
});

test('the spotlight rings a real element inside a real shadow root', async () => {
  const page = await context.newPage();

  // Stand in for OpenRouter. Context-level routing sees the service worker's
  // requests, which is where every network call in this extension lives.
  await context.route('**openrouter.ai/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/v1/key')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
    }
    if (url.includes('/api/v1/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'fake/model', name: 'Fake' }] }),
      });
    }

    const body = route.request().postDataJSON();
    const prompt: string = JSON.stringify(body?.messages ?? '');

    // The request carries the rendered outline, so the real ref id for the
    // cancel button can be read straight out of it — no guessing at `e7`, and
    // no test-only hook in production code to expose the registry.
    const ref = /(e\d+) button: Cancel subscription/.exec(prompt)?.[1];

    const payload = prompt.includes('The user says')
      ? {
          answer: 'Use Cancel subscription.',
          steps: [],
          refs: ref ? [ref] : [],
          suggestions: [],
          target_reason: 'This button ends the plan.',
        }
      : {
          tldr: 'This is the billing page.',
          key_points: [],
          what_you_can_do_here: [],
          suggestions: [],
        };

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    });
  });

  await page.goto('http://localhost:5200/plain.html');
  await page.locator('button[aria-label="Open Page Guide"]').click();

  // Save a key through the real setup form, so the real storage path runs.
  await page.locator('input[type="password"]').fill('sk-or-e2e-fake');
  await page.locator('button[type="submit"]').click();

  await expect(
    page.locator('p:has-text("This is the billing page.")'),
  ).toBeVisible({ timeout: 20_000 });

  await page
    .locator('textarea[placeholder="What are you trying to do here?"]')
    .fill('how do I cancel');
  await page
    .locator('textarea[placeholder="What are you trying to do here?"]')
    .press('Enter');

  const ring = page.locator('[data-testid="spotlight-ring"]');
  await expect(ring).toBeVisible({ timeout: 20_000 });

  // The assertion that jsdom cannot make: the box is on the element.
  const geometry = await page.evaluate(() => {
    const host = document.querySelector('page-guide-ui')!;
    const root = host.shadowRoot!;
    const r = root.querySelector('[data-testid="spotlight-ring"]')!.getBoundingClientRect();
    const t = document.getElementById('cancel')!.getBoundingClientRect();
    return {
      ringOffsetTop: Math.round(t.top - r.top),
      ringOffsetLeft: Math.round(t.left - r.left),
      ringExtraWidth: Math.round(r.width - t.width),
      scrimBands: root.querySelectorAll('[data-testid="spotlight-scrim"]').length,
      clickReachesTarget:
        document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)?.id ?? null,
      tooltip: root.querySelector('[data-testid="spotlight-tooltip"]')?.textContent ?? '',
    };
  });

  // SCRIM_PAD is 6 on every side.
  expect(geometry.ringOffsetTop).toBe(6);
  expect(geometry.ringOffsetLeft).toBe(6);
  expect(geometry.ringExtraWidth).toBe(12);
  expect(geometry.scrimBands).toBeGreaterThan(0);
  expect(geometry.clickReachesTarget).toBe('cancel');
  expect(geometry.tooltip).toContain('This button ends the plan.');

  await page.close();
});
