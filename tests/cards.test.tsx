import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnswerCard from '@/components/AnswerCard';
import SummaryCard from '@/components/SummaryCard';
import type { Answer, Step, Summary } from '@/lib/openrouter';

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
    goal_reached: false,
    ...over,
  };
}

function step(text: string, over: Partial<Step> = {}): Step {
  return { text, ref: '', fill: '', ...over };
}

/**
 * `steps`/`currentIndex`/`onPickStep` are required props, so every case states
 * them. The default is "an answer with no walkthrough", which is still a real
 * case — a question that needed no steps.
 */
function card(props: Partial<Parameters<typeof AnswerCard>[0]> = {}) {
  return (
    <AnswerCard
      question="q"
      answer={answer()}
      steps={[]}
      currentIndex={null}
      onPickStep={vi.fn()}
      targets={[]}
      onPick={vi.fn()}
      {...props}
    />
  );
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
    render(card({ question: 'how do I upgrade?' }));

    expect(screen.getByText('how do I upgrade?')).toBeInTheDocument();
    expect(screen.getByText('Click Upgrade.')).toBeInTheDocument();
  });

  it('numbers the steps from one', () => {
    render(
      card({
        steps: [step('Open settings'), step('Press Upgrade'), step('Confirm')],
        currentIndex: 0,
      }),
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
    render(card());

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('marks the current step, and only that one', () => {
    render(
      card({ steps: [step('One'), step('Two'), step('Three')], currentIndex: 1 }),
    );

    const items = screen.getAllByRole('listitem');
    expect(items[1]!.firstElementChild).toHaveAttribute('aria-current', 'step');
    expect(items[0]!.firstElementChild).not.toHaveAttribute('aria-current');
    expect(items[2]!.firstElementChild).not.toHaveAttribute('aria-current');
  });

  it('renders two steps that read the same, rather than dropping one', () => {
    // The regression this pins: `key={step}` on the step string made React drop
    // the duplicate, and "Press Continue" twice on one page is ordinary.
    render(card({ steps: [step('Press Continue'), step('Press Continue')], currentIndex: 0 }));

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('hands the step index to onPickStep when a step is clicked', async () => {
    const user = userEvent.setup();
    const onPickStep = vi.fn();
    render(card({ steps: [step('One'), step('Two')], currentIndex: 0, onPickStep }));

    await user.click(screen.getByRole('button', { name: /Two/ }));

    // The step list is the interactive surface: clicking one jumps the
    // highlight there.
    expect(onPickStep).toHaveBeenCalledWith(1);
  });

  it('announces the current step, with its position in the walkthrough', () => {
    render(
      card({
        steps: [step('Type the product name'), step('Press Search')],
        currentIndex: 1,
      }),
    );

    // The on-page tooltip is `aria-hidden` decoration; this block is what a
    // screen reader announces.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Step 2 of 2: Press Search');
  });

  it('says every step here is done once the index runs past the list', () => {
    render(card({ steps: [step('Press Search')], currentIndex: 1 }));

    expect(screen.getByRole('status')).toHaveTextContent('Every step on this page is done.');
  });

  it('says the goal is met when the model says so', () => {
    render(card({ answer: answer({ goal_reached: true }) }));

    expect(screen.getByRole('status')).toHaveTextContent("That's everything — this looks done.");
  });

  it('names a ref the user picked instead of a step, when that is what is ringed', () => {
    render(
      card({
        steps: [step('Press Search')],
        currentIndex: null,
        targets: [{ ref: 'e2', label: 'Upgrade' }],
        pickedLabel: 'Upgrade',
      }),
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Highlighted on the page: Upgrade');
    // Exactly one sentence about exactly one highlight — never both.
    expect(status).not.toHaveTextContent('Press Search');
  });

  it('omits the status block when nothing is highlighted and nothing is walked', () => {
    render(card());

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('lists the resolved targets under "On this page"', () => {
    render(
      card({ answer: answer({ refs: ['e2'] }), targets: [{ ref: 'e2', label: 'Upgrade' }] }),
    );

    expect(screen.getByText('On this page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upgrade/ })).toBeInTheDocument();
  });

  it('omits "On this page" when no refs resolved to an element', () => {
    render(card({ answer: answer({ refs: ['e99'] }) }));

    expect(screen.queryByText('On this page')).not.toBeInTheDocument();
  });

  it('hands the ref id — not the label — to onPick when a target is clicked', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      card({
        answer: answer({ refs: ['e2'] }),
        targets: [{ ref: 'e2', label: 'Upgrade' }],
        onPick,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Upgrade/ }));

    // The label is display text; the ref is what resolves to a live element.
    expect(onPick).toHaveBeenCalledWith('e2');
  });
});
