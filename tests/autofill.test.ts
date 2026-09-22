import { describe, expect, it, vi } from 'vitest';
import { canFill, fillField } from '@/lib/autofill';

function mount<T extends HTMLElement>(html: string): T {
  document.body.innerHTML = html;
  return document.body.firstElementChild as T;
}

/** Record every event a real site would be listening for. */
function watch(el: Element): string[] {
  const seen: string[] = [];
  for (const type of ['input', 'change']) {
    el.addEventListener(type, (e) => seen.push(`${e.type}:${e.bubbles}`));
  }
  return seen;
}

describe('fillField — text inputs', () => {
  it('sets the value and tells the page, with both events bubbling', () => {
    const input = mount<HTMLInputElement>('<input type="search" />');
    const seen = watch(input);

    expect(fillField(input, 'wool socks')).toBe('filled');
    expect(input.value).toBe('wool socks');
    expect(seen).toEqual(['input:true', 'change:true']);
  });

  it('goes through the prototype value setter, not a plain assignment', () => {
    const input = mount<HTMLInputElement>('<input />');

    // The regression this pins: React installs its own `value` property on the
    // element, so `el.value = text` writes to React's shadowed property and the
    // site's state never updates. Shadowing it here is how that is simulated.
    const shadowed: string[] = [];
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: (v: string) => shadowed.push(v),
    });

    expect(fillField(input, 'wool socks')).toBe('filled');

    // The native setter was used, so the framework's own property saw nothing.
    expect(shadowed).toEqual([]);
    expect(
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(input),
    ).toBe('wool socks');
  });

  it('focuses the field before the value lands', () => {
    const input = mount<HTMLInputElement>('<input />');
    const order: string[] = [];
    input.addEventListener('focus', () => order.push('focus'));
    input.addEventListener('input', () => order.push('input'));

    fillField(input, 'x');

    // A site that builds its suggestion list on focus must see focus first, or
    // it builds the list from the old value.
    expect(order).toEqual(['focus', 'input']);
  });

  it('fills a textarea the same way', () => {
    const area = mount<HTMLTextAreaElement>('<textarea></textarea>');
    const seen = watch(area);

    expect(fillField(area, 'a longer note')).toBe('filled');
    expect(area.value).toBe('a longer note');
    expect(seen).toHaveLength(2);
  });

  it('replaces whatever the field already held', () => {
    const input = mount<HTMLInputElement>('<input value="cotton shirt" />');

    fillField(input, 'wool socks');

    expect(input.value).toBe('wool socks');
  });
});

describe('fillField — refusals', () => {
  it('reports missing for no element at all', () => {
    expect(fillField(null, 'x')).toBe('missing');
  });

  const blocked: Array<[string, string]> = [
    ['a password field', '<input type="password" />'],
    ['a hidden field', '<input type="hidden" />'],
    ['a file field', '<input type="file" />'],
    ['a disabled field', '<input disabled />'],
    ['a readonly field', '<input readonly />'],
    ['a disabled textarea', '<textarea disabled></textarea>'],
    ['a card number field', '<input autocomplete="cc-number" />'],
    ['a card security code field', '<input autocomplete="cc-csc" />'],
    ['a card expiry field', '<input autocomplete="cc-exp" />'],
    ['a one-time code field', '<input autocomplete="one-time-code" />'],
    ['a card number in a token list', '<input autocomplete="section-card shipping CC-Number" />'],
  ];

  for (const [label, html] of blocked) {
    it(`blocks ${label}, and writes nothing to it`, () => {
      const input = mount<HTMLInputElement>(html);
      const seen = watch(input);

      // Putting model-generated text into a payment or OTP field is not a
      // feature, and a disabled or readonly field is not ours to change.
      expect(fillField(input, 'secret')).toBe('blocked');
      expect(input.value).toBe('');
      expect(seen).toEqual([]);
      expect(canFill(input)).toBe(false);
    });
  }

  const unsupported: Array<[string, string]> = [
    ['a contenteditable search box', '<div contenteditable role="textbox">old</div>'],
    ['a role=combobox div', '<div role="combobox"></div>'],
    ['a button', '<button type="button">Search</button>'],
    ['a link', '<a href="/x">Go</a>'],
  ];

  for (const [label, html] of unsupported) {
    it(`reports ${label} as unsupported`, () => {
      const el = mount<HTMLElement>(html);

      // `lib/snapshot.ts` calls role=textbox/combobox elements `kind: 'field'`
      // too, so narrowing on `kind` instead of `instanceof` would try to set
      // `.value` on an element that has none.
      expect(fillField(el, 'wool socks')).toBe('unsupported');
      expect(canFill(el)).toBe(false);
    });
  }
});

describe('fillField — select', () => {
  const HTML = `
    <select>
      <option value="">Choose…</option>
      <option value="uk">United Kingdom</option>
      <option value="it">Italy</option>
    </select>`;

  it('matches an option by its value, case-insensitively', () => {
    const select = mount<HTMLSelectElement>(HTML);
    const seen = watch(select);

    expect(fillField(select, 'IT')).toBe('filled');
    expect(select.value).toBe('it');
    expect(seen).toEqual(['input:true', 'change:true']);
  });

  it('matches an option by its visible label', () => {
    const select = mount<HTMLSelectElement>(HTML);

    // The model saw the outline's names, so the label is what it will produce.
    expect(fillField(select, 'united kingdom')).toBe('filled');
    expect(select.value).toBe('uk');
  });

  it('refuses rather than guessing when no option matches', () => {
    const select = mount<HTMLSelectElement>(HTML);

    expect(fillField(select, 'Atlantis')).toBe('unsupported');
    expect(select.value).toBe('');
  });

  it('blocks a disabled select', () => {
    const select = mount<HTMLSelectElement>('<select disabled><option value="a">A</option></select>');

    expect(fillField(select, 'a')).toBe('blocked');
  });
});

describe('canFill', () => {
  it('is true only for a field fillField would actually fill', () => {
    expect(canFill(mount<HTMLInputElement>('<input type="text" />'))).toBe(true);
    expect(canFill(mount<HTMLTextAreaElement>('<textarea></textarea>'))).toBe(true);
    expect(canFill(mount<HTMLSelectElement>('<select><option>A</option></select>'))).toBe(true);
    expect(canFill(null)).toBe(false);
  });

  it('answers without touching the field', () => {
    const input = mount<HTMLInputElement>('<input />');
    const focus = vi.spyOn(input, 'focus');
    const seen = watch(input);

    canFill(input);

    // It is asked on every render to decide whether to show a button; it must
    // have no effect on the page.
    expect(focus).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});
