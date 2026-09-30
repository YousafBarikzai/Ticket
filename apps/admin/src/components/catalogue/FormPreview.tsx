'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { InlineAlert, SegmentedControl } from '@itsm/ui';
import { FormRenderer, type FormDefinition, type FormValues, type UserOption } from '@itsm/ui/forms';
import { api } from '../../client/api.js';

/**
 * The requester's view of a form, as the portal draws it (SPEC §6.1): the
 * same `FormRenderer`, in steps, filled in for real — conditions show and
 * hide questions as answers change — with nothing sent.
 *
 * *Light* / *Dark* sets the theme on this pane alone (`data-itsm-theme`),
 * so an administrator working in one appearance checks the other; *Phone*
 * / *Desktop* sets its width. Above the form, optionally, the portal's tile
 * for the request: its name and summary, as the catalogue lists it.
 */
export function FormPreview({
  definition,
  title,
  tile,
  devices = false,
  emptyText = 'No questions: the requester is asked for a title and a description only.',
  headingLevel = 3,
}: {
  readonly definition: FormDefinition;
  /** The request's name: the first step's title and the Send button's verb. */
  readonly title: string;
  /** The portal tile above the form. */
  readonly tile?: { readonly name: string; readonly summary: string | null; readonly service: string | null };
  /** Offer Phone and Desktop widths. */
  readonly devices?: boolean;
  readonly emptyText?: string;
  readonly headingLevel?: 2 | 3;
}): ReactNode {
  const [theme, setTheme] = useState<'apple' | 'apple-dark'>('apple');
  const [device, setDevice] = useState<'phone' | 'desktop'>('desktop');
  const [values, setValues] = useState<FormValues>({});
  const [sent, setSent] = useState(false);
  const empty = definition.ui.elements.length === 0;

  const loadUsers = useCallback(async (query: string, signal: AbortSignal): Promise<readonly UserOption[]> => {
    try {
      const people = await api.tenant.users({ q: query || undefined, limit: 10, status: 'active' });
      if (signal.aborted) return [];
      return people.map((person) => ({ id: person.id, name: person.displayName || person.email, ...(person.email ? { detail: person.email } : {}) }));
    } catch {
      return [];
    }
  }, []);

  // A fresh definition (a question renamed, one added) keeps the answers that still fit.
  const shown = useMemo(() => definition, [definition]);

  return (
    <div className="app-Preview">
      <div className="app-Preview__bar">
        <SegmentedControl
          label="Preview appearance"
          mode="value"
          size="sm"
          value={theme}
          onValueChange={(value) => setTheme(value === 'apple-dark' ? 'apple-dark' : 'apple')}
          options={[
            { value: 'apple', label: 'Light', icon: 'sun' },
            { value: 'apple-dark', label: 'Dark', icon: 'moon' },
          ]}
        />
        {devices ? (
          <SegmentedControl
            label="Preview width"
            mode="value"
            size="sm"
            value={device}
            onValueChange={(value) => setDevice(value === 'phone' ? 'phone' : 'desktop')}
            options={[
              { value: 'phone', label: 'Phone', icon: 'smartphone' },
              { value: 'desktop', label: 'Desktop', icon: 'monitor' },
            ]}
          />
        ) : null}
      </div>
      <div className="app-Preview__frame" data-device={device}>
        <div className="app-Preview__pane" data-itsm-theme={theme}>
          {tile ? (
            <div className="app-Preview__tile" aria-label="How the portal lists it">
              {tile.service ? <span className="app-Preview__service">{tile.service}</span> : null}
              <span className="app-Preview__tileName">{tile.name || 'Untitled request'}</span>
              {tile.summary ? <span className="app-Preview__tileSummary">{tile.summary}</span> : null}
            </div>
          ) : null}
          {empty ? (
            <p className="app-Preview__empty">{emptyText}</p>
          ) : (
            <FormRenderer
              definition={shown}
              values={values}
              onChange={(next) => {
                setSent(false);
                setValues(next);
              }}
              loadUsers={loadUsers}
              mode="steps"
              headingLevel={headingLevel}
              title={title || 'Your request'}
              submitLabel={`Request ${title || 'this'}`}
              onSubmit={() => setSent(true)}
            />
          )}
          {sent ? <InlineAlert tone="success">In the portal, this would send the request. Nothing was sent from the preview.</InlineAlert> : null}
        </div>
      </div>
      <p className="app-Preview__note">Preview only — answers here aren’t saved or sent.</p>
    </div>
  );
}
