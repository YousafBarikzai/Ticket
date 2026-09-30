'use client';

import { useState, type ReactNode } from 'react';
import { Button, Checkbox, FormField, Input, Textarea } from '@itsm/ui';
import { Dialog, PersonPicker, type PersonOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import type { AssetView } from './presentation.js';

/**
 * The asset drawer's three dialogs (SPEC §6.1 `/cmdb/assets`): *Assign to…*
 * (a person, a place, or both — the API closes the previous holding first,
 * so the history never shows one asset in two places), *Return* (back into
 * stock, optionally somewhere new) and *Retire…* (with a reason, and whether
 * it was disposed of — the one that cannot be undone).
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';

export interface AssignChoice {
  readonly person: PersonOption | null;
  readonly location: string;
  readonly note: string;
}

export function AssignDialog({
  asset,
  open,
  onClose,
  onSubmit,
}: {
  readonly asset: AssetView;
  readonly open: boolean;
  onClose(): void;
  onSubmit(choice: AssignChoice): Promise<boolean>;
}): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} title={`Assign ${asset.tag}`} description="To a person, to a place, or both." size="sm">
      {open ? <AssignForm asset={asset} onCancel={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function AssignForm({ asset, onCancel, onSubmit }: { readonly asset: AssetView; onCancel(): void; onSubmit(choice: AssignChoice): Promise<boolean> }): ReactNode {
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  return (
    <form
      className="app-CmdbDialog"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (!person && !location.trim()) {
          setError('Choose who has it, or say where it is.');
          return;
        }
        setError(null);
        setBusy(true);
        const ok = await onSubmit({ person, location: location.trim(), note: note.trim() });
        setBusy(false);
        if (ok) onCancel();
      }}
    >
      <FormField label="Person" optional hint={asset.holder?.name ? `Takes it from ${asset.holder.name}.` : undefined} {...(error ? { error } : {})}>
        {(control) => (
          <PersonPicker
            {...control}
            value={person}
            placeholder="Search people"
            onChange={(next) => {
              setPerson(Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null));
              setError(null);
            }}
            loadPeople={async (query, signal) => {
              const people = await api.tenant.users({ q: query || undefined, limit: 20, status: 'active' });
              if (signal.aborted) return [];
              return people.map((entry) => ({ id: entry.id, name: entry.displayName || entry.email, ...(entry.email ? { detail: entry.email } : {}) }));
            }}
          />
        )}
      </FormField>
      <FormField label="Location" optional hint={asset.location ? `Now: ${asset.location}. Leave empty to keep it.` : 'Like “Leeds office, 2nd floor”.'}>
        <Input value={location} maxLength={200} autoComplete="off" onChange={(event) => setLocation(event.currentTarget.value)} />
      </FormField>
      <FormField label="Note" optional hint="Kept with this holding, like a loan’s end date.">
        <Textarea rows={2} value={note} maxLength={2000} onChange={(event) => setNote(event.currentTarget.value)} />
      </FormField>
      <div className="app-CmdbActions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={busy} {...(online ? {} : { disabledReason: OFFLINE })}>
          Assign
        </Button>
      </div>
    </form>
  );
}

export function ReturnDialog({
  asset,
  open,
  onClose,
  onSubmit,
}: {
  readonly asset: AssetView;
  readonly open: boolean;
  onClose(): void;
  onSubmit(location: string): Promise<boolean>;
}): ReactNode {
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Return ${asset.tag}`}
      description={asset.holder?.name ? `Back from ${asset.holder.name}, into stock.` : 'Back into stock.'}
      size="sm"
    >
      {open ? (
        <form
          className="app-CmdbDialog"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const ok = await onSubmit(location.trim());
            setBusy(false);
            if (ok) {
              setLocation('');
              onClose();
            }
          }}
        >
          <FormField label="Where is it now?" optional hint={asset.location ? `Leave empty to keep “${asset.location}”.` : undefined}>
            <Input value={location} maxLength={200} autoComplete="off" onChange={(event) => setLocation(event.currentTarget.value)} />
          </FormField>
          <div className="app-CmdbActions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={busy} {...(online ? {} : { disabledReason: OFFLINE })}>
              Return to stock
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

export function RetireAssetDialog({
  asset,
  open,
  onClose,
  onSubmit,
}: {
  readonly asset: AssetView;
  readonly open: boolean;
  onClose(): void;
  onSubmit(reason: string, disposed: boolean): Promise<boolean>;
}): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} title={`Retire ${asset.tag}?`} role="alertdialog" size="sm">
      {open ? <RetireForm asset={asset} onCancel={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function RetireForm({ asset, onCancel, onSubmit }: { readonly asset: AssetView; onCancel(): void; onSubmit(reason: string, disposed: boolean): Promise<boolean> }): ReactNode {
  const [reason, setReason] = useState('');
  const [disposed, setDisposed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  return (
    <form
      className="app-CmdbDialog"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (reason.trim().length < 3) {
          setError('Say why it is being retired.');
          return;
        }
        setError(null);
        setBusy(true);
        const ok = await onSubmit(reason.trim(), disposed);
        setBusy(false);
        if (ok) onCancel();
      }}
    >
      <p className="app-CmdbDialog__text">
        {asset.tag} keeps its record and its history of holdings, but leaves the warranty report and can’t be assigned or changed again. This can’t be undone.
      </p>
      <FormField label="Why is it being retired?" required hint="Kept in its history." {...(error ? { error } : {})}>
        <Textarea rows={3} value={reason} maxLength={2000} onChange={(event) => setReason(event.currentTarget.value)} />
      </FormField>
      <Checkbox label="It has been disposed of" description="Sold, recycled or destroyed — not just out of use." checked={disposed} onChange={(event) => setDisposed(event.currentTarget.checked)} />
      <div className="app-CmdbActions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" type="submit" loading={busy} {...(online ? {} : { disabledReason: OFFLINE })}>
          Retire asset
        </Button>
      </div>
    </form>
  );
}
