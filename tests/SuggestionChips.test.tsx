import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuggestionChips from '@/components/SuggestionChips';

describe('SuggestionChips', () => {
  it('renders nothing at all when there are no suggestions', () => {
    const { container } = render(<SuggestionChips suggestions={[]} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows at most three chips, however many it is handed', () => {
    render(
      <SuggestionChips
        suggestions={['one', 'two', 'three', 'four', 'five']}
        onPick={vi.fn()}
      />,
    );

    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.textContent)).toEqual(['one', 'two', 'three']);
  });

  it('reports the picked suggestion verbatim', async () => {
    const onPick = vi.fn();
    render(<SuggestionChips suggestions={['How do I cancel?']} onPick={onPick} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'How do I cancel?' }));

    expect(onPick).toHaveBeenCalledExactlyOnceWith('How do I cancel?');
  });

  it('disables every chip while a request is in flight', () => {
    render(<SuggestionChips suggestions={['a', 'b']} disabled onPick={vi.fn()} />);

    for (const chip of screen.getAllByRole('button')) expect(chip).toBeDisabled();
  });
});
