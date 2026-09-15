'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { queueable } from '@itsm/sdk';
import { submitOrQueue } from '@itsm/pwa';
import { Button, FormField, Input, RadioGroup, Textarea } from '@itsm/ui';
import { URGENCY_CHOICES } from '../tickets/presentation.js';

/**
 * Reporting an issue.
 *
 * Three fields, and the third one is the interesting decision. The platform
 * derives priority from an impact/urgency matrix (MOD-04), and the honest way
 * to collect urgency from somebody who is not on the service desk is to ask
 * what is happening to *them* — "I cannot work" — rather than to show them a
 * dropdown reading High, Medium, Low and hope they calibrate it against
 * everybody else's.
 *
 * Impact is not asked at all. A requester cannot know how many other people
 * are affected, and a form that asks produces a number nobody should act on.
 * The desk sets it.
 *
 * The idempotency key is minted before the request leaves, so a person who
 * double-taps "Report it" on a slow connection raises one ticket rather than
 * two. That is not a nicety on this screen: a duplicate incident splits the
 * conversation and the second copy is the one nobody reads.
 *
 * It is also what makes the offline queue safe. With no network the report
 * goes into the outbox carrying that same key, so a queue that drains twice —
 * a background sync and an `online` event racing — still raises one ticket
 * (doc 14 §5).
 */

export function ReportForm(): ReactNode {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<string>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const request = queueable.reportIssue({
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      urgency: urgency as 'high' | 'medium' | 'low',
    });

    const result = await submitOrQueue({
      action: 'report-issue',
      path: `/api/proxy${request.path}`,
      body: request.body,
      summary: title.trim(),
    });

    if (result.queued) {
      // Not an error. The thing they wrote is safe, and saying so is the whole
      // promise the queue makes.
      setQueued(true);
      setBusy(false);
      return;
    }

    if (result.ok && result.response) {
      const ticket = (await result.response.json()) as { number: string };
      // `replace`, not `push`: the back button from a ticket should reach the
      // page they came from, not a form that would raise a second one.
      router.replace(`/tickets/${ticket.number}?raised=1`);
      return;
    }

    const problem = await readProblem(result.response);
    setFieldErrors(problem.fields);
    setError(
      result.response?.status === 402
        ? 'This organisation has reached its ticket limit. Tell your IT administrator.'
        : problem.message,
    );
    setBusy(false);
  }

  if (queued) {
    return (
      <p className="itsm-Report__queued" role="status">
        You are offline, so this is saved on your device. It will be sent as soon as you are back on a network, and you
        will see it in your tickets then.
      </p>
    );
  }

  return (
    <form className="itsm-Report" onSubmit={submit}>
      <FormField label="What is wrong?" required {...(fieldErrors.title ? { error: fieldErrors.title } : {})}>
        {(control) => (
          <Input
            {...control}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="My laptop will not connect to the VPN"
            maxLength={500}
            autoFocus
          />
        )}
      </FormField>

      <FormField
        label="Anything else that would help?"
        hint="What you were doing, what you saw, anything you have already tried."
        {...(fieldErrors.description ? { error: fieldErrors.description } : {})}
      >
        {(control) => (
          <Textarea
            {...control}
            autoGrow
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </FormField>

      <RadioGroup
        label="How much is this holding you up?"
        value={urgency}
        onChange={setUrgency}
        options={URGENCY_CHOICES.map((choice) => ({
          value: choice.value,
          label: choice.label,
          description: choice.description,
        }))}
      />

      <Button type="submit" variant="primary" loading={busy} loadingLabel="Sending" disabled={title.trim().length === 0}>
        Report it
      </Button>

      {error ? (
        <p className="itsm-Report__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Reads an RFC 9457 problem document, if that is what came back. */
async function readProblem(response?: Response): Promise<{ message: string; fields: Record<string, string> }> {
  if (!response) return { message: 'That did not send. Your text is still here — try again.', fields: {} };
  try {
    const body = (await response.json()) as {
      detail?: string;
      title?: string;
      errors?: { field: string; message: string }[];
    };
    const fields: Record<string, string> = {};
    for (const entry of body.errors ?? []) fields[entry.field] = entry.message;
    return { message: body.detail ?? body.title ?? `That was refused (${response.status}).`, fields };
  } catch {
    return { message: `That was refused (${response.status}).`, fields: {} };
  }
}
