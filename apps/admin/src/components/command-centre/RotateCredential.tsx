'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button, Form, FormField, Input, VisuallyHidden } from '@itsm/ui';
import { Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useMutation } from '../../client/useMutation.js';

/**
 * [Rotate] on an expiring credential, in place (SPEC §6.1 Needs attention).
 *
 * One field: the new value goes in and never comes out — the API answers with
 * the metadata and a fingerprint, and this sheet shows neither. The field is
 * a password field, is never autocompleted, and is cleared when the sheet
 * closes. Success refreshes the briefing, so the row goes once the
 * credential is no longer due.
 */
export function RotateCredential({ credential, context }: { readonly credential: string; readonly context: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const formId = useId();
  const rotate = useMutation((value: string) => api.observe.integrations.rotateCredential(credential, value), {
    success: `Credential ${credential} rotated`,
    failure: `Couldn’t rotate ${credential}`,
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Rotate<VisuallyHidden>: {context}</VisuallyHidden>
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) rotate.reset();
        }}
        size="sm"
        title={`Rotate ${credential}`}
        description="The new value is stored encrypted and is never shown again. Anything using this credential picks it up on its next call."
        dirty={dirty}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={formId} loading={rotate.pending} loadingLabel="Rotating…">
              Rotate
            </Button>
          </>
        }
      >
        {open ? (
          <Form
            id={formId}
            aria-label={`Rotate ${credential}`}
            onDirtyChange={setDirty}
            onSubmit={async (data) => {
              const value = String(data.get('value') ?? '');
              if (value.trim() === '') return { fieldErrors: { value: 'Enter the new value.' } };
              const result = await rotate.run(value);
              if (!result.ok) return { fieldErrors: { ...(result.problem.fieldErrors ?? {}) } };
              setDirty(false);
              setOpen(false);
              return undefined;
            }}
          >
            <FormField label="New value" hint="Paste it exactly as the provider issued it." required>
              <Input name="value" type="password" autoComplete="off" spellCheck={false} />
            </FormField>
          </Form>
        ) : null}
      </Sheet>
    </>
  );
}
