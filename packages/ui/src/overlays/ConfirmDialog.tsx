'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { InlineAlert } from '../feedback/InlineAlert.js';
import { defaultMessages } from '../provider/messages.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ConfirmSpec, LinkComponent } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { Dialog } from '../web/Dialog.js';
import { FormField } from '../web/FormField.js';
import { Input } from '../web/Input.js';
import { Textarea } from '../web/Textarea.js';
import { problemText } from './problem-text.js';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spec: ConfirmSpec;
  /** Client only. The dialog stays open, with the error inline, if this rejects. */
  readonly onConfirm: (reason?: string) => Promise<void>;
  readonly className?: string;
}

const PlainLink: LinkComponent = ({ prefetch, replace, scroll, ...anchor }) => {
  void [prefetch, replace, scroll];
  return <a {...anchor} />;
};

/**
 * Asks before an action that cannot be taken back.
 *
 * - A **danger** confirmation is an `alertdialog` whose first focus is
 *   *Cancel* (X-69): Enter pressed out of habit keeps the thing. Otherwise the
 *   first field, or the confirm button, takes focus.
 * - The confirm button names the result ("Delete rule", never "OK") and shows
 *   a spinner while `onConfirm` runs; the dialog cannot be dismissed half-way.
 *   A rejection keeps it open with the reason inline (announced), so the
 *   person can retry or cancel with their typed reason intact.
 * - `requireReason` adds a reason field and `typeToConfirm` asks for the name
 *   to be typed back; until both are satisfied the confirm button says why it
 *   is unavailable instead of doing nothing (D19). Enter in the typed field
 *   confirms.
 * - `consequences` lists what depends on the thing ("Used by 2 rules"), with
 *   links, before the person commits (X-51).
 */
export function ConfirmDialog({ open, onOpenChange, spec, onConfirm, className }: ConfirmDialogProps): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const Link = itsm?.Link ?? PlainLink;
  const formId = useId();
  const danger = spec.tone === 'danger';

  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const typedRef = useRef<HTMLInputElement | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Every opening starts clean: last time's reason and error are not this time's.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setTyped('');
    setError(null);
    setPending(false);
  }, [open]);

  const reasonSpec = spec.requireReason ? (typeof spec.requireReason === 'object' ? spec.requireReason : { label: 'Reason' }) : null;
  const minLength = Math.max(1, reasonSpec?.minLength ?? 1);
  const reasonValid = !reasonSpec || reason.trim().length >= minLength;
  const typedValid = !spec.typeToConfirm || typed.trim() === spec.typeToConfirm;
  const blocker = !reasonValid
    ? minLength > 1
      ? `Give a reason of at least ${minLength} characters first`
      : 'Give a reason first'
    : !typedValid
      ? `Type ${spec.typeToConfirm} to confirm first`
      : undefined;

  const initialFocusRef = danger ? cancelRef : reasonSpec ? reasonRef : spec.typeToConfirm ? typedRef : confirmRef;

  const confirm = async (): Promise<void> => {
    if (blocker || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(reasonSpec ? reason.trim() : undefined);
      if (live.current) onOpenChange(false);
    } catch (failure) {
      if (live.current) setError(problemText(failure));
    } finally {
      if (live.current) setPending(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void confirm();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onOpenChange(false);
      }}
      title={spec.title}
      description={spec.body}
      size="sm"
      role={danger ? 'alertdialog' : 'dialog'}
      initialFocusRef={initialFocusRef}
      className={cx('itsm-ConfirmDialog', className)}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => !pending && onOpenChange(false)}>
            {spec.cancelLabel ?? messages.cancel}
          </Button>
          <Button
            ref={confirmRef}
            type="submit"
            form={formId}
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            disabledReason={blocker}
          >
            {spec.confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} className="itsm-ConfirmDialog__form" onSubmit={onSubmit} noValidate>
        {spec.consequences && spec.consequences.length > 0 ? (
          <InlineAlert tone="warning" className="itsm-ConfirmDialog__consequences">
            <ul className="itsm-ConfirmDialog__list">
              {spec.consequences.map((consequence) => (
                <li key={`${consequence.label}${consequence.href ?? ''}`}>
                  {consequence.href ? <Link href={consequence.href}>{consequence.label}</Link> : consequence.label}
                </li>
              ))}
            </ul>
          </InlineAlert>
        ) : null}
        {reasonSpec ? (
          <FormField label={reasonSpec.label} hint={reasonSpec.hint} required>
            <Textarea ref={reasonRef} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </FormField>
        ) : null}
        {spec.typeToConfirm ? (
          <FormField
            label={
              <>
                Type <span className="itsm-ConfirmDialog__token">{spec.typeToConfirm}</span> to confirm
              </>
            }
          >
            <Input
              ref={typedRef}
              value={typed}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </FormField>
        ) : null}
        {error ? (
          <div role="alert" className="itsm-ConfirmDialog__error">
            <InlineAlert tone="danger">{error}</InlineAlert>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
