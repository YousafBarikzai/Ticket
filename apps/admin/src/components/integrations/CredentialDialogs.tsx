'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button, Form, FormField, Input, RadioGroup, Textarea, useItsm } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { DatePicker, Dialog, Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { CREDENTIAL_KIND_OPTIONS, credentialRefProblem, type CredentialView } from './presentation.js';

/**
 * Storing and rotating a credential (SPEC §6.1 `/integrations/credentials`).
 *
 * The value goes in and never comes out: the API answers with the metadata
 * and a fingerprint, and no route returns a value to anyone. So both forms
 * use a password field that is never autocompleted, say "never shown again"
 * before the value is typed, and forget it when they close.
 *
 * Rotating keeps the reference (nothing that uses it needs changing) and —
 * because the API's rotation takes only the new value — keeps the expiry
 * date too. The dialog says so rather than letting a desk believe a rotation
 * cleared an expiry warning.
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';

/** The end of the chosen day, as the instant the API stores (a date picker gives a calendar day). */
export function expiryInstant(day: string): string {
  return `${day}T23:59:59Z`;
}

export function AddCredentialSheet({
  open,
  taken,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  /** References already in use: a new one must differ (rotate instead). */
  readonly taken: readonly string[];
  onClose(): void;
  onSaved(ref: string): void;
}): ReactNode {
  const formId = useId();
  const online = useOnline();
  const [dirty, setDirty] = useState(false);
  const [kind, setKind] = useState('generic');
  const [expires, setExpires] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const store = useMutation(
    (input: { ref: string; value: string; kind: string; description?: string; expiresAt?: string }) => api.observe.integrations.createCredential(input),
    { success: (row) => `Credential ${row.ref} stored`, failure: 'Couldn’t store the credential' },
  );

  const close = (): void => {
    setDirty(false);
    setKind('generic');
    setExpires(null);
    store.reset();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="sm"
      title="Add credential"
      description="The value is stored encrypted and is never shown again — not here, not to anyone."
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={store.pending} loadingLabel="Storing…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Store credential
          </Button>
        </>
      }
    >
      {open ? (
        <Form
          id={formId}
          aria-label="Add credential"
          onDirtyChange={setDirty}
          onSubmit={async (data) => {
            const ref = String(data.get('ref') ?? '').trim();
            const value = String(data.get('value') ?? '');
            const description = String(data.get('description') ?? '').trim();
            const errors: Record<string, string> = {};
            const refProblem = credentialRefProblem(ref, taken);
            if (refProblem) errors.ref = refProblem;
            if (value.trim() === '') errors.value = 'Enter the value to store.';
            else if (kind === 'aws_sigv4') {
              try {
                const parsed = JSON.parse(value) as { accessKeyId?: unknown; secretAccessKey?: unknown };
                if (typeof parsed.accessKeyId !== 'string' || typeof parsed.secretAccessKey !== 'string') {
                  errors.value = 'An AWS credential is JSON with accessKeyId and secretAccessKey.';
                }
              } catch {
                errors.value = 'An AWS credential is JSON with accessKeyId and secretAccessKey — this isn’t JSON.';
              }
            }
            if (description.length > 200) errors.description = 'Keep the description to 200 characters.';
            if (expires !== null && expires < today) errors.expiresAt = 'Choose today or a later day.';
            if (Object.keys(errors).length > 0) return { fieldErrors: errors };
            const result = await store.run({
              ref,
              value,
              kind,
              ...(description ? { description } : {}),
              ...(expires ? { expiresAt: expiryInstant(expires) } : {}),
            });
            if (!result.ok) {
              if (result.problem.status === 409) return { fieldErrors: { ref: `A credential called ${ref} already exists. Rotate it instead.` } };
              return result.problem.fieldErrors ? { fieldErrors: result.problem.fieldErrors } : { message: result.problem.detail ?? 'The credential wasn’t stored.' };
            }
            setDirty(false);
            onSaved(result.value.ref);
            close();
            return undefined;
          }}
        >
          <FormField label="Reference" hint="How actions name it: lowercase letters, digits and hyphens, such as slack-bot. It can’t be changed later." required>
            <Input name="ref" autoComplete="off" spellCheck={false} autoCapitalize="off" maxLength={61} />
          </FormField>
          <RadioGroup
            label="Kind"
            value={kind}
            onChange={setKind}
            options={CREDENTIAL_KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label, description: option.hint }))}
          />
          <FormField label="Value" hint={kind === 'aws_sigv4' ? 'Paste the JSON exactly as AWS issued it.' : 'Paste it exactly as the provider issued it.'} required>
            <Input name="value" type="password" autoComplete="off" spellCheck={false} autoCapitalize="off" />
          </FormField>
          <FormField label="Description" optional counter={{ max: 200 }}>
            <Textarea name="description" rows={2} maxLength={200} />
          </FormField>
          <FormField label="Expires" id="expiresAt" optional hint="The Command centre warns 30 days before. Leave empty if it doesn’t expire.">
            {(control) => <DatePicker {...control} value={expires} onChange={setExpires} min={today} />}
          </FormField>
        </Form>
      ) : null}
    </Sheet>
  );
}

export function RotateCredentialDialog({ credential, onClose }: { readonly credential: CredentialView | null; onClose(): void }): ReactNode {
  const formId = useId();
  const online = useOnline();
  const { locale, timeZone } = useItsm();
  const rotate = useMutation((ref: string, value: string) => api.observe.integrations.rotateCredential(ref, value), {
    success: (row) => `Credential ${row.ref} rotated`,
    failure: 'Couldn’t rotate the credential',
  });

  const close = (): void => {
    rotate.reset();
    onClose();
  };

  return (
    <Dialog
      open={credential !== null}
      onClose={close}
      size="sm"
      title={credential ? `Rotate ${credential.ref}` : 'Rotate credential'}
      description="The new value replaces the old one straight away. Anything that uses it picks it up on its next call, and the value is never shown again."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={rotate.pending} loadingLabel="Rotating…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Rotate credential
          </Button>
        </>
      }
    >
      {credential ? (
        <Form
          id={formId}
          aria-label={`Rotate ${credential.ref}`}
          onSubmit={async (data) => {
            const value = String(data.get('value') ?? '');
            if (value.trim() === '') return { fieldErrors: { value: 'Enter the new value.' } };
            const result = await rotate.run(credential.ref, value);
            if (!result.ok) return result.problem.fieldErrors ? { fieldErrors: result.problem.fieldErrors } : { message: result.problem.detail ?? 'The credential wasn’t rotated.' };
            close();
            return undefined;
          }}
        >
          <FormField label="New value" hint="Paste it exactly as the provider issued it." required>
            <Input name="value" type="password" autoComplete="off" spellCheck={false} autoCapitalize="off" />
          </FormField>
          {credential.expiresAt ? (
            <p className="app-Delivery__note">
              Rotating changes the value only: its expiry date, {formatDateTime(credential.expiresAt, { locale, timeZone, style: 'date' })}, stays as it is.
            </p>
          ) : null}
        </Form>
      ) : null}
    </Dialog>
  );
}
