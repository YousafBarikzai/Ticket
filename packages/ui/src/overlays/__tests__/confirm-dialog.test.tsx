// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmSpec } from '../../types.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { ConfirmDialog } from '../ConfirmDialog.js';
import { ConflictDialog, type ConflictChange } from '../ConflictDialog.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => cleanupDocument());

function Harness({ spec, onConfirm }: { readonly spec: ConfirmSpec; readonly onConfirm: (reason?: string) => Promise<void> }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <TestProvider>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Delete rule
      </button>
      <ConfirmDialog open={open} onOpenChange={setOpen} spec={spec} onConfirm={onConfirm} />
    </TestProvider>
  );
}

function open(): HTMLElement {
  const opener = document.querySelector<HTMLButtonElement>('#opener')!;
  focus(opener);
  click(opener);
  const dialog = document.querySelector<HTMLElement>('.itsm-ConfirmDialog');
  if (!dialog) throw new Error('confirmation did not open');
  return dialog;
}

const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.itsm-ConfirmDialog button, .itsm-ConflictDialog button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );

const danger: ConfirmSpec = { title: 'Delete this rule?', body: 'Tickets it routed keep their team.', confirmLabel: 'Delete rule', tone: 'danger' };

describe('ConfirmDialog', () => {
  it('is an alertdialog for danger, with focus on Cancel (X-69)', () => {
    render(<Harness spec={danger} onConfirm={async () => undefined} />);
    const dialog = open();
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(activeElement()?.textContent).toBe('Cancel');
    expect(dialog.textContent).toContain('Tickets it routed keep their team.');
  });

  it('is a plain dialog otherwise, with focus on the confirm button', () => {
    render(<Harness spec={{ title: 'Publish the form?', confirmLabel: 'Publish form' }} onConfirm={async () => undefined} />);
    const dialog = open();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(activeElement()?.textContent).toBe('Publish form');
  });

  it('shows the confirm button busy while it runs, then closes', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<Harness spec={danger} onConfirm={onConfirm} />);
    open();
    click(button('Delete rule')!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button('Delete rule')!.getAttribute('aria-busy')).toBe('true');
    // Busy: pressing again does not run it twice, and Escape does not close it half-way.
    click(button('Delete rule')!);
    press(activeElement()!, 'Escape');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.itsm-ConfirmDialog')).not.toBeNull();

    await act(async () => finish());
    expect(document.querySelector('.itsm-ConfirmDialog')).toBeNull();
  });

  it('stays open with the reason inline, announced, when the action fails', async () => {
    const onConfirm = vi.fn(async () => {
      throw { status: 409, detail: 'Two workflows still use this rule.' };
    });
    render(<Harness spec={danger} onConfirm={onConfirm} />);
    open();
    click(button('Delete rule')!);
    await settle();
    const alert = document.querySelector('.itsm-ConfirmDialog [role="alert"]');
    expect(alert?.textContent).toContain('Two workflows still use this rule.');
    expect(button('Delete rule')!.hasAttribute('aria-busy')).toBe(false);
  });

  it('asks for a reason, and says why confirming waits until there is one', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<Harness spec={{ ...danger, requireReason: { label: 'Why?', minLength: 5 } }} onConfirm={onConfirm} />);
    open();
    const confirm = button('Delete rule')!;
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    const described = (confirm.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '');
    expect(described.join(' ')).toContain('at least 5 characters');
    click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    const reason = document.querySelector<HTMLTextAreaElement>('.itsm-ConfirmDialog textarea')!;
    expect(document.querySelector(`label[for="${reason.id}"]`)?.textContent).toContain('Why?');
    typeInto(reason, '  Duplicate of the board rule  ');
    expect(button('Delete rule')!.hasAttribute('aria-disabled')).toBe(false);
    click(button('Delete rule')!);
    await settle();
    expect(onConfirm).toHaveBeenCalledWith('Duplicate of the board rule');
  });

  it('asks for the name to be typed back, and Enter in that field confirms', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<Harness spec={{ ...danger, title: 'Delete the tenant?', confirmLabel: 'Delete tenant', typeToConfirm: 'acme' }} onConfirm={onConfirm} />);
    open();
    const typed = document.querySelector<HTMLInputElement>('.itsm-ConfirmDialog input')!;
    typeInto(typed, 'acm');
    typed.form?.requestSubmit();
    await settle();
    expect(onConfirm).not.toHaveBeenCalled();

    typeInto(typed, 'acme');
    await act(async () => {
      typed.form?.requestSubmit();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('lists what depends on the thing, with links', () => {
    render(
      <Harness
        spec={{ ...danger, consequences: [{ label: 'Used by 2 rules', href: '/rules?uses=vip' }, { label: 'Referenced by 1 form' }] }}
        onConfirm={async () => undefined}
      />,
    );
    const dialog = open();
    const link = dialog.querySelector<HTMLAnchorElement>('a[href="/rules?uses=vip"]');
    expect(link?.textContent).toBe('Used by 2 rules');
    expect(dialog.textContent).toContain('Referenced by 1 form');
  });

  it('gives focus back to its opener on Cancel', () => {
    render(<Harness spec={danger} onConfirm={async () => undefined} />);
    open();
    click(button('Cancel')!);
    expect(document.querySelector('.itsm-ConfirmDialog')).toBeNull();
    expect(activeElement()?.id).toBe('opener');
  });
});

describe('ConflictDialog', () => {
  const changes: ConflictChange[] = [
    { field: 'Status', theirs: 'In progress', mine: 'Resolved', by: 'Jo', at: new Date(Date.now() - 120_000).toISOString() },
    { field: 'Priority', theirs: 'P1' },
  ];

  function ConflictHarness(props: { readonly onApplyMine: () => Promise<void>; readonly onKeepTheirs: () => void; readonly retryOnly?: { label: string } }): ReactNode {
    const [open, setOpen] = useState(true);
    return <ConflictDialog open={open} onOpenChange={setOpen} entityLabel="INC-000123" changes={changes} {...props} />;
  }

  it('says what changed and who changed it, and focuses the choice that overwrites nobody', () => {
    render(<ConflictHarness onApplyMine={async () => undefined} onKeepTheirs={() => undefined} />);
    const dialog = document.querySelector<HTMLElement>('.itsm-ConflictDialog')!;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('INC-000123 changed while you were editing');
    const rows = [...dialog.querySelectorAll('.itsm-ConflictDialog__change')].map((row) => row.textContent);
    expect(rows[0]).toContain('Jo changed Status to In progress');
    expect(rows[0]).toContain('Yours: Resolved');
    expect(rows[1]).toContain('Someone changed Priority to P1');
    expect(activeElement()?.textContent).toBe('Keep theirs');
  });

  it('keeps theirs', () => {
    const onKeepTheirs = vi.fn();
    const onApplyMine = vi.fn(async () => undefined);
    render(<ConflictHarness onApplyMine={onApplyMine} onKeepTheirs={onKeepTheirs} />);
    click(button('Keep theirs')!);
    expect(onKeepTheirs).toHaveBeenCalledTimes(1);
    expect(onApplyMine).not.toHaveBeenCalled();
    expect(document.querySelector('.itsm-ConflictDialog')).toBeNull();
  });

  it('applies mine on top, and closes once that has worked', async () => {
    const onApplyMine = vi.fn(async () => undefined);
    render(<ConflictHarness onApplyMine={onApplyMine} onKeepTheirs={() => undefined} />);
    click(button('Apply my change on top')!);
    await settle();
    expect(onApplyMine).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.itsm-ConflictDialog')).toBeNull();
  });

  it('stays open with the reason when applying fails', async () => {
    const onApplyMine = vi.fn(async () => {
      throw new Error('The ticket is closed.');
    });
    render(<ConflictHarness onApplyMine={onApplyMine} onKeepTheirs={() => undefined} />);
    click(button('Apply my change on top')!);
    await settle();
    expect(document.querySelector('.itsm-ConflictDialog [role="alert"]')?.textContent).toContain('The ticket is closed.');
  });

  it('offers a single retry when the rest was already saved', async () => {
    const onApplyMine = vi.fn(async () => undefined);
    const onKeepTheirs = vi.fn();
    render(<ConflictHarness onApplyMine={onApplyMine} onKeepTheirs={onKeepTheirs} retryOnly={{ label: 'Retry status change' }} />);
    expect(button('Keep theirs')).toBeUndefined();
    click(button('Retry status change')!);
    await settle();
    expect(onApplyMine).toHaveBeenCalledTimes(1);
  });
});
