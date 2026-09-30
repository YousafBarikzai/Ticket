'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, DurationField, FormField, IconButton, Input, NumberField, SegmentedControl, Select, StatusPill, Switch, notify, useItsm } from '@itsm/ui';
import { Menu, type MenuItemSpec } from '@itsm/ui/overlays';
import { useTheme } from '@itsm/ui/theme';
import type { SettingType } from '@itsm/sdk';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { JsonView } from '../JsonView.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import {
  anchorId,
  choicesFor,
  controlFor,
  numberParts,
  numberProblem,
  percentProblem,
  sameValue,
  settingEntry,
  textProblem,
  valueText,
  type ControlKind,
} from '../../settings/catalogue.js';
import { useReachable } from './links.js';
import type { SettingItem } from './types.js';

/**
 * One setting as a row (SPEC §6.1 Settings › General, X-11): its label and
 * what it does, a control shaped by its type, and — only when it differs
 * from the default — who changed it and when. The key, History and Reset to
 * default sit in the row's ⋯.
 *
 * - Switches, segmented choices and selects **apply at once**, with an Undo
 *   in the toast (a switch that stops something for everyone asks first and
 *   keeps its state until the question is answered).
 * - Numbers, durations, percentages and text show **Save** and **Cancel**
 *   once changed, check the value against the same rules the API applies,
 *   and take an optional note for the history.
 * - A structured value the page cannot draw a form for is shown as JSON and
 *   changed through the API (ADR-0049: no JSON text box).
 *
 * Without `admin.setting.manage` the row shows the value in words instead of
 * a control (D19); the page's *View only* pill says why.
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';

export interface SettingRowProps {
  readonly item: SettingItem;
  readonly canManage: boolean;
}

/** Writes one setting, with a toast that can put the old value back. */
function useSettingWriter(item: SettingItem): { apply(value: unknown, reason?: string): Promise<boolean>; readonly pending: boolean } {
  const router = useRouter();
  const save = useMutation((value: unknown, reason: string | undefined) => api.tenant.setSetting(item.key, value, reason ? { reason } : {}), {
    failure: `Couldn’t save “${item.label}”`,
  });
  return {
    pending: save.pending,
    async apply(value, reason) {
      const before = item.value;
      const result = await save.run(value, reason);
      if (!result.ok) return false;
      notify(`${item.label} saved`, {
        tone: 'success',
        description: `Now ${valueText(item.key, item.type, value).replace(/^./, (first) => first.toLowerCase())}.`,
        undo: async () => {
          await api.tenant.setSetting(item.key, before, { reason: 'Undone' });
          router.refresh();
        },
      });
      return true;
    },
  };
}

export function SettingRow({ item, canManage }: SettingRowProps): ReactNode {
  const labelId = useId();
  const descriptionId = useId();
  const entry = settingEntry(item.key);
  const kind = controlFor(item.key, item.type);
  const writable = canManage && !item.locked && !entry.managedAt && kind !== 'readonly';

  return (
    <div
      className={kind === 'fields' || (kind === 'readonly' && !writable) ? 'app-SettingRow app-SettingRow--wide' : 'app-SettingRow'}
      id={anchorId('setting', item.key)}
      tabIndex={-1}
      data-changed={item.changed ? '' : undefined}
    >
      <div className="app-SettingRow__text">
        <p className="app-SettingRow__label" id={labelId}>
          {item.label}
          {item.changed ? <StatusPill size="sm" tone="neutral" label="Changed" srPrefix="Setting" /> : null}
        </p>
        {item.description ? (
          <p className="app-SettingRow__description" id={descriptionId}>
            {item.description}
          </p>
        ) : null}
        {item.note ? <p className="app-SettingRow__note">{item.note}</p> : null}
        <TechnicalKey value={item.key} label="setting key" />
      </div>
      <div className="app-SettingRow__control" data-row-control="">
        {writable ? (
          <Control item={item} kind={kind} labelId={labelId} describedBy={item.description ? descriptionId : undefined} />
        ) : (
          <ReadOnlyValue item={item} kind={kind} />
        )}
      </div>
      <RowMenu item={item} writable={writable} />
    </div>
  );
}

function ReadOnlyValue({ item, kind }: { readonly item: SettingItem; readonly kind: ControlKind }): ReactNode {
  const { Link } = useItsm();
  const entry = settingEntry(item.key);
  const managedHref = useReachable(entry.managedAt?.href);
  if (kind === 'readonly' && typeof item.value === 'object' && item.value !== null) {
    return (
      <div className="app-SettingRow__json">
        <JsonView value={item.value} label={item.label} openDepth={1} />
        <p className="app-SettingRow__hint">Changed through the API.</p>
      </div>
    );
  }
  return (
    <div className="app-SettingRow__readonly">
      <span className="app-SettingRow__value">{valueText(item.key, item.type, item.value)}</span>
      {entry.managedAt ? (
        managedHref ? (
          <Link href={managedHref} className="app-SettingRow__managed">
            Change on {entry.managedAt.label}
          </Link>
        ) : null
      ) : item.locked ? (
        <span className="app-SettingRow__hint">Set for your organisation; changed through the API.</span>
      ) : null}
    </div>
  );
}

/** ⋯: History, Reset to default, and the key for people who show keys. */
function RowMenu({ item, writable }: { readonly item: SettingItem; readonly writable: boolean }): ReactNode {
  const history = useDrawer('setting');
  const { prefs } = useTheme();
  const online = useOnline();
  const writer = useSettingWriter(item);
  const items: MenuItemSpec[] = [
    { id: 'history', label: 'History', icon: 'history', onSelect: () => history.open(item.key) },
    ...(writable && item.changed
      ? [
          {
            id: 'reset',
            label: 'Reset to default',
            icon: 'undo-2' as const,
            description: `Back to ${valueText(item.key, item.type, item.default).replace(/^./, (first) => first.toLowerCase())}`,
            ...(online ? {} : { disabled: true, disabledReason: OFFLINE }),
            onSelect: () => void writer.apply(item.default, 'Reset to default'),
          },
        ]
      : []),
    ...(prefs.showKeys
      ? [{ id: 'copy-key', label: 'Copy key', icon: 'copy' as const, onSelect: () => void navigator.clipboard?.writeText(item.key).catch(() => undefined) }]
      : []),
  ];
  return (
    <div className="app-SettingRow__more">
      <Menu label={`More for ${item.label}`} align="end" trigger={<IconButton icon="ellipsis" label={`More for ${item.label}`} size="sm" variant="ghost" />} items={items} />
    </div>
  );
}

/* =========================================================================
 * Controls
 * ====================================================================== */

interface ControlProps {
  readonly item: SettingItem;
  readonly kind: ControlKind;
  readonly labelId: string;
  readonly describedBy: string | undefined;
}

function Control({ item, kind, labelId, describedBy }: ControlProps): ReactNode {
  switch (kind) {
    case 'switch':
      return <SwitchControl item={item} />;
    case 'segmented':
    case 'select':
      return <ChoiceControl item={item} kind={kind} labelId={labelId} describedBy={describedBy} />;
    default:
      return <DraftControl item={item} kind={kind} labelId={labelId} describedBy={describedBy} />;
  }
}

/**
 * The value this row shows: the one just chosen, until the server renders
 * the row again — then the server's, whatever it is. Keyed on the row object
 * (a new one comes with every server render), not on the value: a save
 * followed at once by Undo can come back as the very value the row started
 * from, and a control that waited for the value to change would stick on
 * the choice that was undone (F30).
 */
function useShown<T>(server: T, source: object): [T, (value: T) => void] {
  const [local, setLocal] = useState<{ readonly source: object; readonly value: T }>({ source, value: server });
  if (local.source !== source) {
    setLocal({ source, value: server });
    return [server, (value) => setLocal({ source, value })];
  }
  return [local.value, (value) => setLocal({ source, value })];
}

function SwitchControl({ item }: { readonly item: SettingItem }): ReactNode {
  const online = useOnline();
  const writer = useSettingWriter(item);
  const entry = settingEntry(item.key);
  const [shown, setShown] = useShown(item.value === true, item);
  return (
    <Switch
      label={item.label}
      labelHidden
      checked={shown}
      disabled={!online}
      {...(entry.confirm ? { confirm: entry.confirm } : {})}
      onRequestChange={(next) => writer.apply(next)}
      onChange={setShown}
    />
  );
}

function ChoiceControl({ item, kind, labelId, describedBy }: ControlProps): ReactNode {
  const online = useOnline();
  const writer = useSettingWriter(item);
  const [shown, setShown] = useShown(typeof item.value === 'string' ? item.value : String(item.value ?? ''), item);
  const choices = choicesFor(item.key, item.type, item.value);
  const choose = async (next: string): Promise<void> => {
    if (next === shown || writer.pending) return;
    const before = shown;
    setShown(next);
    if (!(await writer.apply(next))) setShown(before);
  };
  if (kind === 'segmented') {
    return (
      <SegmentedControl
        mode="commit"
        size="sm"
        label={item.label}
        value={shown}
        options={choices.map((choice) => ({ value: choice.value, label: choice.label, ...(online ? {} : { disabled: true }) }))}
        onValueChange={(next) => void choose(next)}
      />
    );
  }
  return (
    <Select
      aria-labelledby={labelId}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      size="sm"
      value={shown}
      disabled={!online || writer.pending}
      options={choices}
      onChange={(event) => void choose(event.currentTarget.value)}
    />
  );
}

/* ---- Save / Cancel editors ---------------------------------------------- */

type Draft = number | null | string | Record<string, number | null>;

function initialDraft(item: SettingItem, kind: ControlKind): Draft {
  const value = item.value;
  if (kind === 'percent') return typeof value === 'number' ? Math.round(value * 1000) / 10 : null;
  if (kind === 'number' || kind === 'duration') return typeof value === 'number' ? value : null;
  if (kind === 'text') return typeof value === 'string' ? value : '';
  if (kind === 'fields') {
    const record = (value ?? {}) as Record<string, unknown>;
    return Object.fromEntries((numberParts(item.type) ?? []).map((part) => [part.key, typeof record[part.key] === 'number' ? (record[part.key] as number) : null]));
  }
  return null;
}

/** The draft as the value the API takes, or why it cannot be. */
export function draftToValue(item: Pick<SettingItem, 'key' | 'type'>, kind: ControlKind, draft: Draft): { ok: true; value: unknown } | { ok: false; problem: string; field?: string } {
  const type = item.type;
  if (kind === 'percent') {
    const percent = typeof draft === 'number' ? draft : null;
    const problem = percentProblem(type, percent);
    return problem ? { ok: false, problem } : { ok: true, value: Math.round(percent! * 10) / 1000 };
  }
  if (kind === 'number' || kind === 'duration') {
    const n = typeof draft === 'number' ? draft : null;
    const problem = numberProblem(type, n);
    return problem ? { ok: false, problem } : { ok: true, value: n };
  }
  if (kind === 'text') {
    const text = typeof draft === 'string' ? draft.trim() : '';
    const problem = textProblem(type, text);
    return problem ? { ok: false, problem } : { ok: true, value: text };
  }
  if (kind === 'fields') {
    const parts = numberParts(type) ?? [];
    const record = (draft ?? {}) as Record<string, number | null>;
    const out: Record<string, number> = {};
    for (const part of parts) {
      const problem = numberProblem(part.type, record[part.key] ?? null);
      if (problem) return { ok: false, problem, field: part.key };
      out[part.key] = record[part.key]!;
    }
    return { ok: true, value: out };
  }
  return { ok: false, problem: 'This setting is changed through the API.' };
}

function plural(n: number | null, unit: { one: string; other: string } | undefined): string | undefined {
  if (!unit) return undefined;
  return n === 1 ? unit.one : unit.other;
}

function DraftControl({ item, kind, labelId, describedBy }: ControlProps): ReactNode {
  const online = useOnline();
  const writer = useSettingWriter(item);
  const entry = settingEntry(item.key);
  const errorId = useId();
  const noteId = useId();
  const start = initialDraft(item, kind);
  const [server, setServer] = useState(item.value);
  const [draft, setDraft] = useState<Draft>(start);
  const [problem, setProblem] = useState<{ text: string; field?: string } | null>(null);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');

  // A new value from the server (a save, an Undo, someone else) replaces an untouched draft.
  if (!sameValue(server, item.value)) {
    setServer(item.value);
    setDraft(initialDraft(item, kind));
    setProblem(null);
  }

  const dirty = !sameValue(draft, start);
  const reset = (): void => {
    setDraft(start);
    setProblem(null);
    setNoting(false);
    setNote('');
  };

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!dirty || writer.pending) return;
    const parsed = draftToValue(item, kind, draft);
    if (!parsed.ok) {
      setProblem({ text: parsed.problem, ...(parsed.field ? { field: parsed.field } : {}) });
      return;
    }
    setProblem(null);
    const saved = await writer.apply(parsed.value, note.trim() || undefined);
    if (saved) {
      setNoting(false);
      setNote('');
    }
  };

  const invalid = problem !== null;
  const describe = [describedBy, invalid ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  const type = item.type as SettingType;
  const numberType = type.kind === 'number' ? type : null;

  let field: ReactNode;
  if (kind === 'fields') {
    const parts = numberParts(type) ?? [];
    const record = (draft ?? {}) as Record<string, number | null>;
    field = (
      <div className="app-SettingRow__fields" role="group" aria-labelledby={labelId}>
        {parts.map((part) => (
          <FormField key={part.key} label={entry.fields?.[part.key] ?? part.key} {...(problem?.field === part.key ? { error: problem.text } : {})} className="app-SettingRow__part">
            <NumberField
              value={record[part.key] ?? null}
              onChange={(next) => setDraft({ ...record, [part.key]: next })}
              {...(part.type.min !== undefined ? { min: part.type.min } : {})}
              {...(part.type.max !== undefined ? { max: part.type.max } : {})}
              {...(plural(record[part.key] ?? null, entry.unit) ? { unit: plural(record[part.key] ?? null, entry.unit)! } : {})}
              size="sm"
            />
          </FormField>
        ))}
      </div>
    );
  } else if (kind === 'duration') {
    field = (
      <DurationField
        label={item.label}
        value={typeof draft === 'number' ? draft : null}
        onChange={(next) => setDraft(next)}
        units={['h', 'm']}
        {...(numberType?.min !== undefined ? { min: numberType.min } : {})}
        {...(numberType?.max !== undefined ? { max: numberType.max } : {})}
        invalid={invalid}
        size="sm"
        aria-describedby={describe}
      />
    );
  } else if (kind === 'text') {
    field = (
      <Input
        aria-labelledby={labelId}
        aria-describedby={describe}
        value={typeof draft === 'string' ? draft : ''}
        onChange={(event) => setDraft(event.currentTarget.value)}
        invalid={invalid}
        size="sm"
        autoComplete="off"
        spellCheck={false}
        {...(type.kind === 'string' && type.max !== undefined ? { maxLength: type.max } : {})}
        placeholder={item.default === '' ? 'Not set' : undefined}
      />
    );
  } else {
    const percent = kind === 'percent';
    const n = typeof draft === 'number' ? draft : null;
    field = (
      <NumberField
        label={item.label}
        value={n}
        onChange={(next) => setDraft(next)}
        {...(percent
          ? { min: 1, max: 100, step: 5, unit: '%' }
          : {
              ...(numberType?.min !== undefined ? { min: numberType.min } : {}),
              ...(numberType?.max !== undefined ? { max: numberType.max } : {}),
              ...(plural(n, entry.unit) ? { unit: plural(n, entry.unit)! } : {}),
            })}
        invalid={invalid}
        size="sm"
        aria-describedby={describe}
      />
    );
  }

  return (
    <form
      className="app-SettingRow__form"
      aria-labelledby={labelId}
      noValidate
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && dirty) {
          event.preventDefault();
          reset();
        }
      }}
    >
      {field}
      {invalid && !problem.field ? (
        <p id={errorId} className="app-SettingRow__error" role="alert">
          {problem.text}
        </p>
      ) : null}
      {dirty ? (
        <div className="app-SettingRow__actions">
          {noting ? (
            <Input
              id={noteId}
              aria-label={`Note for the history of ${item.label}`}
              placeholder="Why it changed (optional)"
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.currentTarget.value)}
              size="sm"
              className="app-SettingRow__noteField"
            />
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setNoting(true)}>
              Add a note
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={reset}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={writer.pending} loadingLabel="Saving…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Save
          </Button>
        </div>
      ) : null}
    </form>
  );
}
