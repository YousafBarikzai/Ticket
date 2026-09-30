'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { Button, Checkbox, Textarea } from '@itsm/ui';
import { Dialog, Popover } from '@itsm/ui/overlays';

/**
 * "Resolve…" (SPEC §6.2): what fixed it, then Resolve — one step where the
 * old screen needed a reply, a status menu and a Move.
 *
 * The text is prefilled from the reply the person has already started, is
 * sent to the requester (or kept as an internal note with "Keep this
 * private"), and becomes the resolution's reason. The comment goes first,
 * with its own idempotency key, then the move — the workspace sequences the
 * two, so a conflict on the move never sends the comment twice.
 *
 * A popover on the next-step button; a small dialog when it is asked for
 * from elsewhere (the status menu, the palette) on a ticket whose next step
 * is something else.
 */

export interface ResolveInput {
  readonly text: string;
  /** Sent as an internal note rather than a reply. */
  readonly private: boolean;
}

interface ResolveFormProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The composer's reply, when it has one. */
  readonly initialText?: string;
  /** May reply to the requester; without it the text can only be a note. */
  readonly canReply: boolean;
  /** May add an internal note; without it "Keep this private" is not offered. */
  readonly canNote: boolean;
  /** Resolves with nothing on success (it closes), or a message to show in it. */
  readonly onResolve: (input: ResolveInput) => Promise<string | void>;
}

function ResolveForm({ open, onClose, initialText = '', canReply, canNote, onResolve }: ResolveFormProps): ReactNode {
  const fieldId = useId();
  const [text, setText] = useState(initialText);
  const [keepPrivate, setKeepPrivate] = useState(!canReply && canNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);

  // Each opening starts from what the composer holds now (and only an
  // opening: the composer's text changing underneath must not reset this).
  const latest = useRef({ initialText, canReply, canNote });
  latest.current = { initialText, canReply, canNote };
  useEffect(() => {
    if (!open) return;
    const now = latest.current;
    setText(now.initialText);
    setKeepPrivate(!now.canReply && now.canNote);
    setError(null);
    setBusy(false);
    const frame = requestAnimationFrame(() => field.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const canWrite = canReply || canNote;
  const label = keepPrivate ? 'What fixed it? (internal note)' : 'What fixed it? (sent to the requester)';

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await onResolve({ text: text.trim(), private: keepPrivate || !canReply });
      if (failure) setError(failure);
      else onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="app-Resolve" onSubmit={(event) => void submit(event)}>
      {canWrite ? (
        <>
          <label className="app-Resolve__label" htmlFor={fieldId}>
            {label}
          </label>
          <Textarea
            ref={field}
            id={fieldId}
            rows={3}
            autoGrow
            maxRows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            submitShortcut="mod+enter"
            submitHint="to resolve"
            placeholder={keepPrivate ? 'Only agents will see this.' : 'The requester will receive this.'}
          />
          {canReply && canNote ? (
            <Checkbox
              label="Keep this private"
              description="Adds it as an internal note instead of a reply."
              checked={keepPrivate}
              onChange={(event) => setKeepPrivate(event.target.checked)}
            />
          ) : null}
        </>
      ) : (
        <p className="app-Resolve__note">The requester will see the ticket as resolved.</p>
      )}
      {error ? (
        <p className="app-Resolve__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="app-Resolve__actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} loadingLabel="Resolving…" iconStart="circle-check">
          Resolve
        </Button>
      </div>
    </form>
  );
}

export interface ResolvePopoverProps extends Omit<ResolveFormProps, 'onClose'> {
  /** The button that opens it: the next step. */
  readonly trigger: ReactElement<{ id?: string }>;
  readonly onOpenChange: (open: boolean) => void;
}

export function ResolvePopover({ trigger, open, onOpenChange, ...form }: ResolvePopoverProps): ReactNode {
  return (
    <Popover trigger={trigger} title="Resolve this ticket" open={open} onOpenChange={onOpenChange} width="md" align="end">
      <ResolveForm {...form} open={open} onClose={() => onOpenChange(false)} />
    </Popover>
  );
}

export interface ResolveDialogProps extends Omit<ResolveFormProps, 'onClose'> {
  /** "INC-000123", for the title. */
  readonly number: string;
  readonly onOpenChange: (open: boolean) => void;
}

export function ResolveDialog({ number, open, onOpenChange, ...form }: ResolveDialogProps): ReactNode {
  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} title={`Resolve ${number}`} size="sm">
      <ResolveForm {...form} open={open} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}
