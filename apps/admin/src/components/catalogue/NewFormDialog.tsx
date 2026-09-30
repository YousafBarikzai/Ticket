'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FormErrorSummary, FormField, Input, RadioGroup, Select } from '@itsm/ui';
import { Dialog } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import type { KeyState } from '../../keys.js';
import { KeyField } from '../KeyField.js';
import { blankDocument, type FormView } from './presentation.js';

/**
 * "New form" (SPEC §6.1): a name, its key, and whether to start from a
 * blank form or a copy of one that exists. It is created as a draft — nobody
 * sees a draft — and the editor opens on it, which is where the questions
 * are written.
 */
export function NewFormDialog({
  open,
  onClose,
  forms,
  from,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly forms: readonly FormView[];
  /** The form to duplicate, when opened by *Duplicate*. */
  readonly from?: FormView;
}): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} title={from ? `Duplicate ${from.name}` : 'New form'} description="Starts as a draft. Nobody sees it until you publish it." size="md">
      {open ? <NewForm key={from?.key ?? 'new'} forms={forms} onClose={onClose} {...(from ? { from } : {})} /> : null}
    </Dialog>
  );
}

function NewForm({ forms, from, onClose }: { readonly forms: readonly FormView[]; readonly from?: FormView; readonly onClose: () => void }): ReactNode {
  const router = useRouter();
  const online = useOnline();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(from ? `${from.name} (copy)` : '');
  const [key, setKey] = useState('');
  const [keyState, setKeyState] = useState<KeyState>('empty');
  const [start, setStart] = useState<'blank' | 'copy'>(from ? 'copy' : 'blank');
  const [copyOf, setCopyOf] = useState(from?.key ?? forms[0]?.key ?? '');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const create = useMutation(
    (input: Record<string, unknown>) => api.configure.catalogue.createForm(input),
    { success: () => `${name.trim()} created as a draft`, failure: 'Couldn’t create the form', refresh: false },
  );

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: field === 'name' ? 'new-form-name' : 'new-form-key', message }));

  return (
    <form
      id={formId}
      className="app-NewForm"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (!name.trim()) found.name = 'Enter a name for the form.';
        else if (keyState !== 'ok') found.key = keyState === 'taken' ? 'Another form already uses this key. Edit the key or change the name.' : keyState === 'reserved' ? 'That key is reserved. Edit the key.' : 'Edit the key by hand: this name can’t make one.';
        setErrors(found);
        if (Object.keys(found).length > 0) {
          setAttempt((value) => value + 1);
          return;
        }
        const source = start === 'copy' ? forms.find((form) => form.key === copyOf) : undefined;
        const document = source ? { ...source.document, key } : blankDocument(key);
        // A draft carries no version stamp: that is what publishing adds.
        const { version: _version, ...draft } = document as typeof document & { version?: number };
        const result = await create.run({ key, name: name.trim(), ...(source?.description ? { description: source.description } : {}), document: draft });
        if (result.ok) {
          onClose();
          router.push(`/catalogue/forms/${encodeURIComponent(key)}`);
          return;
        }
        if (result.problem.status === 409) setErrors({ key: 'Another form already uses this key. Edit the key or change the name.' });
        setAttempt((value) => value + 1);
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}
      <FormField label="Name" required hint="Like “Laptop request”. Requesters don’t see it; request types do." id="new-form-name" {...(errors.name ? { error: errors.name } : {})}>
        <Input ref={nameRef} autoFocus value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.currentTarget.value)} />
      </FormField>
      <div id="new-form-key" tabIndex={-1}>
        <KeyField source={name} rule="slug" value={key} onChange={setKey} onStateChange={setKeyState} taken={forms.map((form) => form.key)} noun="form" />
        {errors.key ? <p className="app-FieldError">{errors.key}</p> : null}
      </div>
      {forms.length > 0 ? (
        <>
          <RadioGroup
            label="Start from"
            value={start}
            onChange={(value) => setStart(value)}
            options={[
              { value: 'blank', label: 'A blank form' },
              { value: 'copy', label: 'A copy of another form', description: 'Its questions, as they are saved now.' },
            ]}
          />
          {start === 'copy' ? (
            <FormField label="Form to copy">
              <Select value={copyOf} options={forms.map((form) => ({ value: form.key, label: form.name }))} onChange={(event) => setCopyOf(event.currentTarget.value)} />
            </FormField>
          ) : null}
        </>
      ) : null}
      <div className="app-DialogFooter">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={create.pending} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
          Create and edit
        </Button>
      </div>
    </form>
  );
}
