import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  return { answer: 'Click Upgrade.', steps: [], refs: [], suggestions: [], ...over };
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
    render(<AnswerCard question="how do I upgrade?" answer={answer()} refLabels={[]} />);

    expect(screen.getByText('how do I upgrade?')).toBeInTheDocument();
    expect(screen.getByText('Click Upgrade.')).toBeInTheDocument();
  });

  it('numbers the steps from one', () => {
    render(
      <AnswerCard
        question="q"
        answer={answer({ steps: ['Open settings', 'Press Upgrade', 'Confirm'] })}
        refLabels={[]}
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
    render(<AnswerCard question="q" answer={answer({ steps: [] })} refLabels={[]} />);

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('lists the resolved ref labels under "On this page"', () => {
    render(<AnswerCard question="q" answer={answer({ refs: ['e2'] })} refLabels={['Upgrade']} />);

    expect(screen.getByText('On this page')).toBeInTheDocument();
    expect(screen.getByText('Upgrade')).toBeInTheDocument();
  });

  it('omits "On this page" when no refs resolved to a label', () => {
    render(<AnswerCard question="q" answer={answer({ refs: ['e99'] })} refLabels={[]} />);

    expect(screen.queryByText('On this page')).not.toBeInTheDocument();
  });
});
