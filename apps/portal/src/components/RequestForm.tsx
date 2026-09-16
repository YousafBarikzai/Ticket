'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import type { FormDefinition, FormErrors, FormValues } from '@itsm/contracts';
import { ApiError } from '@itsm/sdk';
import { Button, FormRenderer } from '@itsm/ui';
import { api } from '../client/api.js';

/**
 * A catalogue request, rendered by the one form renderer.
 *
 * `FormRenderer` is the same component the admin preview, the chat modals and
 * the mobile app use (doc 14 §2). That is the whole point of it: a conditional
 * field that hides in the portal and shows in Slack is a support call nobody
 * can reproduce.
 *
 * Two things this screen has to get right on its own:
 *
 * **Validation is the server's.** The renderer shows what the API returned in
 * `problem.errors`, mapped back onto the fields. Client-side validation as
 * well would be a second implementation of the rules in the form definition,
 * and the two would disagree the first time a condition changed.
 *
 * **A request with no form is still a request.** Some catalogue items take no
 * answers — "order the standard laptop" — and the honest rendering of that is
 * a button, not an empty form with a heading.
 */

export interface RequestFormProps {
  readonly itemKey: string;
  readonly itemName: string;
  readonly definition: FormDefinition | null;
}

export function RequestForm({ itemKey, itemName, definition }: RequestFormProps): ReactNode {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The directory search behind every `user` field, injected because the
   * design system must not know about the SDK or the session. It goes through
   * the proxy like everything else the browser does.
   */
  const loadUsers = useCallback(async (query: string, signal: AbortSignal) => {
    const response = await fetch(`/api/proxy/api/v1/users?q=${encodeURIComponent(query)}&limit=20`, {
      signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { id: string; displayName: string; email: string }[] };
    return (body.data ?? []).map((user) => ({ id: user.id, name: user.displayName, detail: user.email }));
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrors({});

    try {
      const result = await api.submitRequest(itemKey, values);
      router.replace(`/tickets/${result.ticketNumber}?raised=1`);
    } catch (failure) {
      if (failure instanceof ApiError) {
        // The API returns field-level problems for a form that did not
        // validate; anything else is a message for the top of the page.
        const fields = failure.fieldErrors;
        setErrors(fields as FormErrors);
        setError(Object.keys(fields).length > 0 ? 'Some answers need another look.' : failure.message);
      } else {
        setError('That did not send. Your answers are still here — try again.');
      }
      setBusy(false);
    }
  }

  return (
    <form className="itsm-Request" onSubmit={submit}>
      {definition ? (
        <FormRenderer
          definition={definition}
          values={values}
          onChange={setValues}
          errors={errors}
          loadUsers={loadUsers}
          disabled={busy}
        />
      ) : (
        <p className="itsm-Request__noForm">There is nothing to fill in. Send it and we will take it from there.</p>
      )}

      <Button type="submit" variant="primary" loading={busy} loadingLabel="Sending">
        Request {itemName}
      </Button>

      {error ? (
        <p className="itsm-Request__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
