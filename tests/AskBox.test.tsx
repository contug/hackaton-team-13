import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AskBox from '@/components/AskBox';

function setup(props: Partial<React.ComponentProps<typeof AskBox>> = {}) {
  const onSubmit = vi.fn();
  render(<AskBox onSubmit={onSubmit} {...props} />);
  return { onSubmit, user: userEvent.setup(), field: screen.getByRole('textbox') };
}

describe('AskBox', () => {
  it('submits the trimmed question on Enter and clears the field', async () => {
    const { onSubmit, user, field } = setup();

    await user.type(field, '   how do I cancel?   ');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('how do I cancel?');
    expect(field).toHaveValue('');
  });

  it('submits on the Ask button too', async () => {
    const { onSubmit, user, field } = setup();

    await user.type(field, 'where is my invoice?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('where is my invoice?');
  });

  it('inserts a newline on Shift+Enter without submitting', async () => {
    const { onSubmit, user, field } = setup();

    await user.type(field, 'first line');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(field, 'second line');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveValue('first line\nsecond line');
  });

  it('ignores a whitespace-only question', async () => {
    const { onSubmit, user, field } = setup();

    await user.type(field, '    ');
    await user.keyboard('{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });

  it('accepts nothing while disabled', async () => {
    const { onSubmit, user, field } = setup({ disabled: true });

    expect(field).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();

    await user.type(field, 'anything');
    await user.keyboard('{Enter}');

    expect(field).toHaveValue('');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
