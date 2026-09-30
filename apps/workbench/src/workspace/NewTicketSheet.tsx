'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { newIdempotencyKey } from '@itsm/pwa';
import type { CreateTicketInput } from '@itsm/sdk';
import { Button, FormField, Input, SegmentedControl, Textarea, describeProblem, notify, useItsm } from '@itsm/ui';
import { Sheet } from '@itsm/ui/overlays';
import { api } from '../client/api.js';
import { deskKeys } from '../client/query-client.js';
import { problemOf } from '../inbox/presentation.js';

/**
 * The new-ticket sheet (SPEC §6.2), opened by `c`, the compose button and the
 * palette.
 *
 * **Stub → WP25.** The frame's contract is the props below; this first
 * version already raises a ticket — type, title, description — so the
 * compose button is never a dead end. WP25 adds the requester, impact and
 * urgency with the live priority preview, team and assignee, category and
 * service, and the local draft.
 *
 * One idempotency key per intent: minted when the sheet opens and reused on a
 * retry after a network failure, so pressing *Create ticket* twice is one
 * ticket (F17).
 */

export interface NewTicketSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Called with the new ticket's number once it exists. */
  readonly onCreated?: (number: string) => void;
}

type TicketType = NonNullable<CreateTicketInput['type']>;

const TYPES: readonly { value: TicketType; label: string }[] = [
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'question', label: 'Question' },
];

export function NewTicketSheet({ open, onOpenChange, onCreated }: NewTicketSheetProps): ReactNode {
  const client = useQueryClient();
  const { router } = useItsm();
  const formId = useId();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [type, setType] = useState<TicketType>('incident');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (open) idempotencyKey.current ??= newIdempotencyKey();
  }, [open]);

  const reset = (): void => {
    setType('incident');
    setTitle('');
    setDescription('');
    setTitleError(undefined);
    idempotencyKey.current = null;
  };

  const create = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError('Give the ticket a title, so it can be found in a list.');
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const ticket = await api.createTicket(
        { type, title: trimmed, ...(description.trim() ? { description: description.trim() } : {}), sourceChannel: 'api' },
        { idempotencyKey: idempotencyKey.current ?? newIdempotencyKey() },
      );
      reset();
      onOpenChange(false);
      void client.invalidateQueries({ queryKey: deskKeys.counts() });
      void client.invalidateQueries({ queryKey: deskKeys.views() });
      onCreated?.(ticket.number);
      notify(`${ticket.number} created`, {
        tone: 'success',
        action: { label: 'Open', onClick: () => router.push(`/tickets/${encodeURIComponent(ticket.number)}`) },
      });
    } catch (error) {
      const problem = problemOf(error);
      if (problem.fieldErrors?.title) setTitleError(problem.fieldErrors.title);
      const { title: heading, body } = describeProblem(problem);
      notify(heading, { tone: 'danger', description: body });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      side="auto"
      size="md"
      title="New ticket"
      dirty={title.trim() !== '' || description.trim() !== ''}
      initialFocusRef={titleRef}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={saving} loadingLabel="Creating ticket">
            Create ticket
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="app-NewTicket"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void create();
          }
        }}
      >
        <SegmentedControl
          label="Type"
          mode="value"
          value={type}
          options={TYPES.map((option) => ({ value: option.value, label: option.label }))}
          onValueChange={(value) => setType(value as TicketType)}
        />
        <FormField label="Title" required {...(titleError ? { error: titleError } : {})}>
          <Input
            ref={titleRef}
            value={title}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleError(undefined);
            }}
          />
        </FormField>
        <FormField label="Description" optional hint="What happened, and what was expected. The requester sees this.">
          <Textarea value={description} rows={6} onChange={(event) => setDescription(event.target.value)} />
        </FormField>
      </form>
    </Sheet>
  );
}

export default NewTicketSheet;
