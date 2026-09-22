import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Spotlight from '@/components/Spotlight';
import { refFor } from '@/lib/refs';

/**
 * These tests use the REAL `lib/refs` registry — mint a ref from a real element
 * and pass back the id you were given. `refs.test.ts` uses `vi.resetModules()`
 * because it is about that module's own state; here the singleton is what we
 * want, and the monotonic counter means the id is never predictable anyway.
 *
 * Note there is no `scrollIntoView` stub: jsdom does not implement it, the
 * component calls it optionally, and each test that cares assigns its own spy
 * to the element. One less fiction in `tests/setup.ts`.
 */
function place(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

/** Let one animation frame pass, which is how re-measures are scheduled. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function mount(over: Partial<Parameters<typeof Spotlight>[0]> = {}) {
  const onLost = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <Spotlight
      targetRef={over.targetRef ?? 'e999'}
      label={over.label ?? 'Cancel subscription'}
      reason={over.reason ?? 'This is the button that ends the plan.'}
      onDismiss={over.onDismiss ?? onDismiss}
      onLost={over.onLost ?? onLost}
    />,
  );
  return { ...view, onLost: over.onLost ?? onLost, onDismiss: over.onDismiss ?? onDismiss };
}

describe('Spotlight', () => {
  it('rings the element and explains why it was highlighted', () => {
    // An inline `left` keeps the target off the viewport edge, so all four
    // scrim bands have area. Elements default to left 0 under the rect stub.
    const target = place(
      '<button style="left: 400px" data-test-rect="300,40">Cancel subscription</button>',
    );
    mount({ targetRef: refFor(target) });

    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();
    expect(screen.getAllByTestId('spotlight-scrim')).toHaveLength(4);
    // Scoped to the tooltip: the target button on the page carries the same
    // text, which is the normal case — the label IS the element's name.
    const tooltip = screen.getByTestId('spotlight-tooltip');
    expect(tooltip).toHaveTextContent('This is the button that ends the plan.');
    expect(tooltip).toHaveTextContent('Cancel subscription');
  });

  it('draws the ring over the target, padded', () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    mount({ targetRef: refFor(target) });

    const ring = screen.getByTestId('spotlight-ring');
    // 6px of padding on every side of a 200x40 rect at top 300.
    expect(ring.style.top).toBe('294px');
    expect(ring.style.height).toBe('52px');
    expect(ring.style.position).toBe('fixed');
  });

  it('renders nothing but the probe when the ref no longer resolves', () => {
    place('<button>Unrelated</button>');
    const { onLost } = mount({ targetRef: 'e999999' });

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spotlight-scrim')).not.toBeInTheDocument();
    expect(onLost).toHaveBeenCalled();
  });

  it('renders nothing when the target measures zero by zero', () => {
    const target = place('<button data-test-rect="300,0">Collapsed</button>');
    const { onLost } = mount({ targetRef: refFor(target) });

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    expect(onLost).toHaveBeenCalled();
  });

  it('renders nothing when fixed positioning cannot be trusted', async () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    const { onLost } = mount({ targetRef: refFor(target) });
    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();

    // A degenerate sentinel means `position: fixed` is resolving against
    // something other than the viewport. Pointing at the wrong control is
    // worse than pointing at nothing, so everything goes away.
    screen.getByTestId('spotlight-probe').style.width = '0px';
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();

    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
    // The target is fine — only our own frame is broken — so this is not a loss.
    expect(onLost).not.toHaveBeenCalled();
  });

  it('never intercepts pointer events except on the tooltip itself', () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    mount({ targetRef: refFor(target) });

    for (const band of screen.getAllByTestId('spotlight-scrim')) {
      expect(band.style.pointerEvents).toBe('none');
    }
    expect(screen.getByTestId('spotlight-ring').style.pointerEvents).toBe('none');
    // The tooltip carries the dismiss control, so it alone takes clicks.
    expect(screen.getByTestId('spotlight-tooltip').style.pointerEvents).toBe('auto');
  });

  it('sits below the panel in the stacking order', () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    mount({ targetRef: refFor(target) });

    // The panel and the FAB are z-[2147483000]; the scrim must not dim them.
    expect(Number(screen.getByTestId('spotlight-ring').style.zIndex)).toBeLessThan(2147483000);
  });

  it('scrolls an off-screen target into view exactly once, centred', () => {
    const target = place('<button data-test-rect="4000,40">Far below</button>');
    const spy = vi.fn();
    target.scrollIntoView = spy;

    mount({ targetRef: refFor(target) });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ block: 'center', inline: 'nearest' });
  });

  it('leaves a target that is already comfortably in view alone', () => {
    const target = place('<button data-test-rect="300,40">Right here</button>');
    const spy = vi.fn();
    target.scrollIntoView = spy;

    mount({ targetRef: refFor(target) });

    expect(spy).not.toHaveBeenCalled();
  });

  it('re-measures when the page scrolls', async () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    mount({ targetRef: refFor(target) });
    expect(screen.getByTestId('spotlight-ring').style.top).toBe('294px');

    target.setAttribute('data-test-rect', '500,40');
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();

    expect(screen.getByTestId('spotlight-ring').style.top).toBe('494px');
  });

  it('re-measures when the window resizes', async () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    mount({ targetRef: refFor(target) });

    target.setAttribute('data-test-rect', '200,40');
    window.dispatchEvent(new Event('resize'));
    await nextFrame();

    expect(screen.getByTestId('spotlight-ring').style.top).toBe('194px');
  });

  it('reports the target as lost once it leaves the DOM', async () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    const { onLost } = mount({ targetRef: refFor(target) });
    expect(onLost).not.toHaveBeenCalled();

    target.remove();
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('notices a target that disappears without any scroll or resize', async () => {
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    const { onLost } = mount({ targetRef: refFor(target) });
    expect(screen.getByTestId('spotlight-ring')).toBeInTheDocument();

    // An SPA re-render fires no event. The heartbeat is what catches it, and it
    // is the reason a ring never sits pointing at nothing.
    target.remove();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(onLost).toHaveBeenCalled();
    expect(screen.queryByTestId('spotlight-ring')).not.toBeInTheDocument();
  });

  it('offers a way to hide the highlight', async () => {
    const user = userEvent.setup();
    const target = place('<button data-test-rect="300,40">Cancel</button>');
    const { onDismiss } = mount({ targetRef: refFor(target) });

    await user.click(screen.getByRole('button', { name: 'Hide highlight' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
