'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import type { CiClassRow } from '@itsm/sdk';
import { Button, FormField, SegmentedControl, Select, Textarea } from '@itsm/ui';
import { Combobox, Dialog, type ComboboxOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import {
  CI_STATUS_LOOK,
  SETTABLE_STATUSES,
  lookOf,
  relateChoices,
  relationSentence,
  relationshipFor,
  type CiView,
  type RelationshipType,
  type SettableStatus,
} from './presentation.js';

const OFFLINE = 'You’re offline — changes can’t be saved.';

/**
 * Change status: Operational, Degraded or Down, with an optional note kept in
 * the item's history (SPEC §6.1). Retiring is not offered here: it is its own
 * action, with its own confirmation, because it is the one meant to be hard
 * to do by accident.
 */
export function StatusDialog({
  ci,
  open,
  onClose,
  onSubmit,
}: {
  readonly ci: CiView;
  readonly open: boolean;
  onClose(): void;
  /** Resolves true when saved, which closes the dialog. */
  onSubmit(status: SettableStatus, note: string): Promise<boolean>;
}): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} title={`Status of ${ci.name}`} size="sm">
      {open ? <StatusForm ci={ci} onCancel={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function StatusForm({ ci, onCancel, onSubmit }: { readonly ci: CiView; onCancel(): void; onSubmit(status: SettableStatus, note: string): Promise<boolean> }): ReactNode {
  const initial = (SETTABLE_STATUSES as readonly string[]).includes(ci.status) ? (ci.status as SettableStatus) : 'operational';
  const [status, setStatus] = useState<SettableStatus>(initial);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const unchanged = status === ci.status;
  return (
    <form
      className="app-CmdbDialog"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (unchanged) return;
        setBusy(true);
        const ok = await onSubmit(status, note.trim());
        setBusy(false);
        if (ok) onCancel();
      }}
    >
      <SegmentedControl
        label="Status"
        mode="value"
        fullWidth
        value={status}
        options={SETTABLE_STATUSES.map((value) => ({ value, label: lookOf(CI_STATUS_LOOK, value).label }))}
        onValueChange={(value) => setStatus(value as SettableStatus)}
      />
      <FormField label="Note" optional hint="What’s happening, for whoever looks next. Kept in its history.">
        <Textarea rows={3} value={note} maxLength={2000} onChange={(event) => setNote(event.currentTarget.value)} />
      </FormField>
      <div className="app-CmdbActions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          loading={busy}
          {...(!online ? { disabledReason: OFFLINE } : unchanged ? { disabledReason: `It’s already ${lookOf(CI_STATUS_LOOK, status).label.toLowerCase()}.` } : {})}
        >
          Set status
        </Button>
      </div>
    </form>
  );
}

/**
 * Relate…: how the open item and another relate, chosen as a sentence from
 * the open item's side ("Web shop runs on…", "…runs on Web shop"), the other
 * item found by name, and the whole sentence read back before it is saved —
 * the direction is the mistake worth catching (`modules/assets`
 * relationships). A retired item is not offered: it no longer carries impact.
 */
export interface RelateInput {
  readonly fromCi: string;
  readonly toCi: string;
  readonly type: RelationshipType;
  /** The sentence, for the toast. */
  readonly reads: string;
}

export function RelateDialog({
  ci,
  classes,
  open,
  onClose,
  onSubmit,
}: {
  readonly ci: CiView;
  readonly classes: readonly CiClassRow[];
  readonly open: boolean;
  onClose(): void;
  onSubmit(input: RelateInput): Promise<boolean>;
}): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} title={`Relate ${ci.name}`} description="Record what it needs, or what needs it, so impact can follow." size="md">
      {open ? <RelateForm ci={ci} classes={classes} onCancel={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function RelateForm({ ci, classes, onCancel, onSubmit }: { readonly ci: CiView; readonly classes: readonly CiClassRow[]; onCancel(): void; onSubmit(input: RelateInput): Promise<boolean> }): ReactNode {
  const choices = useMemo(() => relateChoices(ci.name), [ci.name]);
  const [choice, setChoice] = useState(choices[0]!.value);
  const [other, setOther] = useState<ComboboxOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const itemId = useId();
  const picked = choices.find((entry) => entry.value === choice)!;
  const className = new Map(classes.map((row) => [row.id, row.name]));
  const sentence = other ? (picked.thisIsFrom ? relationSentence(picked.type, ci.name, other.label) : relationSentence(picked.type, other.label, ci.name)) : null;

  return (
    <form
      className="app-CmdbDialog"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (!other) {
          setError('Choose the other item.');
          return;
        }
        setError(null);
        setBusy(true);
        const ok = await onSubmit({ ...relationshipFor(picked, ci.id, other.value), reads: sentence ?? '' });
        setBusy(false);
        if (ok) onCancel();
      }}
    >
      <FormField label="How they relate">
        <Select value={choice} options={choices.map((entry) => ({ value: entry.value, label: entry.label }))} onChange={(event) => setChoice(event.currentTarget.value)} />
      </FormField>
      <FormField label="Other item" required id={itemId} {...(error ? { error } : {})}>
        {(control) => (
          <Combobox
            {...control}
            value={other}
            placeholder="Search by name or identifier"
            emptyMessage="No items match"
            onChange={(next) => {
              setOther(next);
              setError(null);
            }}
            loadOptions={async (query, signal) => {
              const rows = await api.observe.estate.cis({ ...(query ? { search: query } : {}), limit: 20 });
              if (signal.aborted) return [];
              return rows
                .filter((row) => row.id !== ci.id)
                .map((row) => ({
                  value: row.id,
                  label: row.name,
                  description: [row.classId ? className.get(row.classId) : null, lookOf(CI_STATUS_LOOK, row.status).label, row.environment].filter(Boolean).join(' · '),
                }));
            }}
          />
        )}
      </FormField>
      <p className="app-CmdbReadBack" aria-live="polite">
        {sentence ?? 'Choose the other item to see how this reads.'}
      </p>
      <div className="app-CmdbActions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={busy} {...(online ? {} : { disabledReason: OFFLINE })}>
          Relate
        </Button>
      </div>
    </form>
  );
}
