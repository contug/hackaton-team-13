import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnswerCard from '@/components/AnswerCard';
import SummaryCard from '@/components/SummaryCard';
import type { Answer, Summary } from '@/lib/openrouter';

function summary(over: Partial<Summary> = {}): Summary {
  return {
    tldr: 'This page lists the plans you can buy.',
    key_points: ['Three plans', 'Monthly or yearly'],
    what_you_can_do_here: ['Upgrade your plan'],
    suggestions: [],
    ...over,
  };
}

function answer(over: Partial<Answer> = {}): Answer {
  return {
    answer: 'Click Upgrade.',
    steps: [],
    refs: [],
    suggestions: [],
    target_reason: '',
    ...over,
  };
}

describe('SummaryCard', () => {
  it('renders the tldr, the key points and the actions', () => {
    render(<SummaryCard summary={summary()} />);

    expect(screen.getByText('This page lists the plans you can buy.')).toBeInTheDocument();
    expect(screen.getByText('Three plans')).toBeInTheDocument();
    expect(screen.getByText('What you can do here')).toBeInTheDocument();
    expect(screen.getByText('Upgrade your plan')).toBeInTheDocument();
  });

  it('omits the "What you can do here" block when there are no actions', () => {
    render(<SummaryCard summary={summary({ what_you_can_do_here: [] })} />);

    expect(screen.queryByText('What you can do here')).not.toBeInTheDocument();
  });

  it('omits the key-point list when there are no key points', () => {
    render(<SummaryCard summary={summary({ key_points: [], what_you_can_do_here: [] })} />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('Three plans')).not.toBeInTheDocument();
  });
});

describe('AnswerCard', () => {
  it('shows the question above the answer', () => {
    render(<AnswerCard question="how do I upgrade?" answer={answer()} targets={[]} onPick={vi.fn()} />);

    expect(screen.getByText('how do I upgrade?')).toBeInTheDocument();
    expect(screen.getByText('Click Upgrade.')).toBeInTheDocument();
  });

  it('numbers the steps from one', () => {
    render(
      <AnswerCard
        question="q"
        answer={answer({ steps: ['Open settings', 'Press Upgrade', 'Confirm'] })}
        targets={[]}
        onPick={vi.fn()}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.textContent)).toEqual([
      '1Open settings',
      '2Press Upgrade',
      '3Confirm',
    ]);
  });

  it('omits the step list entirely when there are no steps', () => {
    render(<AnswerCard question="q" answer={answer({ steps: [] })} targets={[]} onPick={vi.fn()} />);

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('lists the resolved targets under "On this page"', () => {
    render(
      <AnswerCard
        question="q"
        answer={answer({ refs: ['e2'] })}
        targets={[{ ref: 'e2', label: 'Upgrade' }]}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText('On this page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upgrade/ })).toBeInTheDocument();
  });

  it('omits "On this page" when no refs resolved to an element', () => {
    render(
      <AnswerCard question="q" answer={answer({ refs: ['e99'] })} targets={[]} onPick={vi.fn()} />,
    );

    expect(screen.queryByText('On this page')).not.toBeInTheDocument();
  });

  it('hands the ref id — not the label — to onPick when a target is clicked', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <AnswerCard
        question="q"
        answer={answer({ refs: ['e2'] })}
        targets={[{ ref: 'e2', label: 'Upgrade' }]}
        onPick={onPick}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Upgrade/ }));

    // The label is display text; the ref is what resolves to a live element.
    expect(onPick).toHaveBeenCalledWith('e2');
  });

  it('names the highlighted element and why it matters, politely', () => {
    render(
      <AnswerCard
        question="q"
        answer={answer({ refs: ['e2'] })}
        targets={[{ ref: 'e2', label: 'Upgrade' }]}
        onPick={vi.fn()}
        highlight={{ label: 'Upgrade', reason: 'This button starts the plan change.' }}
      />,
    );

    // The panel is the authoritative surface: the on-page tooltip is decoration
    // and is aria-hidden, so this block is what a screen reader announces.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Upgrade');
    expect(status).toHaveTextContent('This button starts the plan change.');
  });

  it('names the highlighted element even when there is no reason for it', () => {
    // Picking a non-primary ref from "On this page" moves the highlight, but
    // `target_reason` only ever described the first one.
    render(
      <AnswerCard
        question="q"
        answer={answer({ refs: ['e2'] })}
        targets={[{ ref: 'e2', label: 'Upgrade' }]}
        onPick={vi.fn()}
        highlight={{ label: 'Upgrade', reason: '' }}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Highlighted on the page: Upgrade');
    expect(status.textContent).not.toMatch(/—\s*$/);
  });

  it('omits the highlight block when nothing is highlighted', () => {
    render(
      <AnswerCard question="q" answer={answer()} targets={[]} onPick={vi.fn()} />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
