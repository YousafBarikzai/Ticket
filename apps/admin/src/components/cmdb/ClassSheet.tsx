'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { CiAttribute, CiClassRow } from '@itsm/sdk';
import { Button, Checkbox, FormErrorSummary, FormField, FormSection, IconButton, InlineAlert, Input, Select, SkeletonText, Textarea } from '@itsm/ui';
import { Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { ATTRIBUTE_KEY, CLASS_KEY, attributeKeyFor, classKeyFor, classOptions, classTree, flattenTree, ownAttributes } from './presentation.js';

/**
 * A class: what kind of thing an item is, and the details every item of it
 * carries (SPEC §6.1 "Manage classes", [Plus]). Without one no item can be
 * recorded, so a new desk starts here.
 *
 * Attributes are typed — text, number, yes or no, date, or one of a list —
 * and inherited: a database server carries whatever a server carries, and
 * may require what its parent left optional. Inherited attributes show
 * read-only above the class's own. Once saved, an attribute's key and type
 * are fixed and it cannot be removed, because items already hold values
 * under it and would stop passing their class's checks on their next edit.
 */

const TYPES: readonly { readonly value: CiAttribute['type']; readonly label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes or no' },
  { value: 'date', label: 'Date' },
  { value: 'enum', label: 'One of a list' },
];

export function typeLabel(type: string): string {
  return TYPES.find((entry) => entry.value === type)?.label ?? type;
}

interface Row {
  /** Stable while editing; not sent. */
  readonly rowId: string;
  readonly saved: boolean;
  readonly label: string;
  readonly key: string;
  readonly keyEdited: boolean;
  readonly type: CiAttribute['type'];
  readonly required: boolean;
  /** Options, one per line, for `enum`. */
  readonly options: string;
}

let rowCounter = 0;
const newRow = (): Row => ({ rowId: `new-${(rowCounter += 1)}`, saved: false, label: '', key: '', keyEdited: false, type: 'string', required: false, options: '' });
const rowOf = (attribute: CiAttribute): Row => ({
  rowId: `saved-${attribute.key}`,
  saved: true,
  label: attribute.label,
  key: attribute.key,
  keyEdited: true,
  type: attribute.type,
  required: attribute.required,
  options: (attribute.options ?? []).join('\n'),
});

/** The rows as the API's attribute list, and what is wrong with them, by row. */
export function attributesFrom(rows: readonly Row[]): { readonly list: CiAttribute[]; readonly problems: Record<string, string> } {
  const problems: Record<string, string> = {};
  const seen = new Set<string>();
  const list: CiAttribute[] = [];
  for (const row of rows) {
    const label = row.label.trim();
    const options = [...new Set(row.options.split('\n').map((line) => line.trim()).filter(Boolean))];
    if (!label) problems[row.rowId] = 'Give the attribute a label.';
    else if (!ATTRIBUTE_KEY.test(row.key)) problems[row.rowId] = 'Its key must start with a lower-case letter and use only letters and numbers.';
    else if (seen.has(row.key)) problems[row.rowId] = `Another attribute already uses the key ${row.key}.`;
    else if (row.type === 'enum' && options.length === 0) problems[row.rowId] = 'List at least one option, one per line.';
    seen.add(row.key);
    list.push({ key: row.key, label, type: row.type, required: row.required, ...(row.type === 'enum' ? { options } : {}) });
  }
  return { list, problems };
}

export function ClassSheet({
  open,
  editKey,
  classes,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  /** The class being edited; a new one without. */
  readonly editKey: string | null;
  readonly classes: readonly CiClassRow[];
  onClose(): void;
  /** Saved: the class's key, so the page can show it. */
  onSaved(key: string): void;
}): ReactNode {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const online = useOnline();
  const editing = editKey ? classes.find((row) => row.key === editKey) : undefined;
  const missing = editKey !== null && !editing;
  const close = (): void => {
    setDirty(false);
    onClose();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="md"
      title={editing ? editing.name : missing ? 'Class' : 'New class'}
      {...(editing || missing ? {} : { description: 'A kind of thing the CMDB records, and the details each one carries.' })}
      dirty={dirty}
      {...(missing
        ? {}
        : {
            footer: (
              <div className="app-CmdbActions">
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" form={formId} loading={busy} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
                  {editing ? 'Save class' : 'Add class'}
                </Button>
              </div>
            ),
          })}
    >
      {missing ? (
        <InlineAlert tone="warning">That class no longer exists. It may have been removed since the link was shared.</InlineAlert>
      ) : open ? (
        <ClassForm
          key={editKey ?? 'new'}
          formId={formId}
          {...(editing ? { editing } : {})}
          classes={classes}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onDone={(key) => {
            setDirty(false);
            onSaved(key);
          }}
        />
      ) : null}
    </Sheet>
  );
}

const IDS = { name: 'class-name', key: 'class-key', parentKey: 'class-parent', description: 'class-description' } as const;

function ClassForm({
  formId,
  editing,
  classes,
  onDirtyChange,
  onBusyChange,
  onDone,
}: {
  readonly formId: string;
  readonly editing?: CiClassRow;
  readonly classes: readonly CiClassRow[];
  onDirtyChange(dirty: boolean): void;
  onBusyChange(busy: boolean): void;
  onDone(key: string): void;
}): ReactNode {
  const tree = useMemo(() => classTree(classes), [classes]);
  const parentOf = editing?.parentId ? classes.find((row) => row.id === editing.parentId) : undefined;
  const [name, setName] = useState(editing?.name ?? '');
  const [key, setKey] = useState(editing?.key ?? '');
  const [keyEdited, setKeyEdited] = useState(Boolean(editing));
  const [parentKey, setParentKey] = useState(parentOf?.key ?? '');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<readonly Row[]>(editing ? [] : [newRow()]);
  const [inherited, setInherited] = useState<{ readonly status: 'loading' | 'ready' | 'failed'; readonly list: readonly CiAttribute[] }>({ status: 'ready', list: [] });
  const [ownLoaded, setOwnLoaded] = useState(!editing);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [reload, setReload] = useState(0);

  const touch = (change: () => void): void => {
    change();
    onDirtyChange(true);
  };

  // What the parent passes down.
  useEffect(() => {
    if (!parentKey) {
      setInherited({ status: 'ready', list: [] });
      return;
    }
    let live = true;
    setInherited({ status: 'loading', list: [] });
    api.observe.estate.classAttributes(parentKey).then(
      (list) => live && setInherited({ status: 'ready', list }),
      () => live && setInherited({ status: 'failed', list: [] }),
    );
    return () => {
      live = false;
    };
  }, [parentKey, reload]);

  // An existing class's own attributes: what it carries, less what its parent passes down unchanged.
  useEffect(() => {
    if (!editing) return;
    let live = true;
    void Promise.all([
      api.observe.estate.classAttributes(editing.key),
      parentOf ? api.observe.estate.classAttributes(parentOf.key) : Promise.resolve([] as CiAttribute[]),
    ]).then(
      ([carried, fromParent]) => {
        if (!live) return;
        setRows(ownAttributes(carried, fromParent).map(rowOf));
        setOwnLoaded(true);
      },
      () => live && setErrors({ attributes: 'Couldn’t load this class’s attributes. Close it and try again.' }),
    );
    return () => {
      live = false;
    };
  }, [editing?.key]);

  const save = useMutation(
    async (input: { readonly attributes: CiAttribute[]; readonly attributesChanged: boolean }) => {
      if (editing) {
        const patch: { name?: string; parentKey?: string; attributes?: CiAttribute[] } = {};
        if (name.trim() !== editing.name) patch.name = name.trim();
        if (parentKey !== (parentOf?.key ?? '')) patch.parentKey = parentKey;
        if (input.attributesChanged) patch.attributes = input.attributes;
        if (Object.keys(patch).length === 0) return editing.key;
        await api.observe.estate.updateClass(editing.key, patch);
        return editing.key;
      }
      const created = await api.observe.estate.createClass({
        key,
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(parentKey ? { parentKey } : {}),
        attributes: input.attributes,
      });
      return created.key;
    },
    { success: () => (editing ? `${name.trim()} saved` : `${name.trim()} added`), failure: editing ? 'Couldn’t save the class' : 'Couldn’t add the class' },
  );

  const excluded = useMemo(() => {
    if (!editing) return new Set<string>();
    const node = flattenTree(tree).find((entry) => entry.key === editing.key);
    // A class cannot sit below itself or below one of its own subclasses.
    return new Set(node ? flattenTree([node]).map((entry) => entry.key) : [editing.key]);
  }, [editing, tree]);

  const originalRows = useMemo(() => JSONish(rows.filter((row) => row.saved)), [ownLoaded]);

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: field in IDS ? IDS[field as keyof typeof IDS] : field.startsWith('new-') || field.startsWith('saved-') ? `attribute-${field}` : '', message }));

  return (
    <form
      id={formId}
      className="app-CmdbForm"
      noValidate
      aria-label={editing ? `Edit ${editing.name}` : 'New class'}
      onSubmit={async (event) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (!name.trim()) found.name = 'Enter a name for the class.';
        if (!editing) {
          if (!CLASS_KEY.test(key)) found.key = 'Its key must start with a lower-case letter and use lower-case letters, numbers and underscores (2 to 61).';
          else if (classes.some((row) => row.key === key)) found.key = 'Another class already uses this key.';
        }
        if (!ownLoaded) found.attributes = 'This class’s attributes are still loading.';
        const checked = attributesFrom(rows.filter((row) => row.saved || row.label.trim() !== '' || row.type !== 'string' || row.options.trim() !== ''));
        Object.assign(found, checked.problems);
        setErrors(found);
        setAttempt((value) => value + 1);
        if (Object.keys(found).length > 0) return;
        onBusyChange(true);
        const result = await save.run({ attributes: checked.list, attributesChanged: JSONish(rows) !== originalRows || rows.some((row) => !row.saved) });
        onBusyChange(false);
        if (result.ok) {
          onDirtyChange(false);
          onDone(result.value);
          return;
        }
        if (result.problem.status === 409) setErrors({ key: 'Another class already uses this key.' });
        else if (result.problem.status === 422) setErrors({ name: result.problem.detail ?? 'Something in the form isn’t right.' });
        setAttempt((value) => value + 1);
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}
      <FormSection title="Class" headingLevel={3}>
        <FormField label="Name" required id={IDS.name} counter={{ max: 120 }} hint="Singular, like “Server” or “Business application”." {...(errors.name ? { error: errors.name } : {})}>
          <Input
            value={name}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => {
              const next = event.currentTarget.value;
              touch(() => {
                setName(next);
                if (!keyEdited) setKey(classKeyFor(next));
              });
            }}
          />
        </FormField>
        {editing ? (
          <p className="app-CmdbForm__fixed">
            <span className="app-CmdbForm__fixedLabel">Key</span> <code className="app-CmdbMono">{editing.key}</code>
            <span className="app-CmdbForm__fixedHint">Imports and the API name the class by its key, so it can’t change.</span>
          </p>
        ) : (
          <FormField label="Key" required id={IDS.key} hint="Made from the name. Lower-case letters, numbers and underscores; permanent." {...(errors.key ? { error: errors.key } : {})}>
            <Input
              value={key}
              maxLength={61}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                const next = event.currentTarget.value;
                touch(() => {
                  setKey(next);
                  setKeyEdited(true);
                });
              }}
            />
          </FormField>
        )}
        <FormField label="Kind of" optional id={IDS.parentKey} hint="A parent class: this one carries everything the parent does.">
          <Select
            value={parentKey}
            options={[{ value: '', label: 'Nothing — a top-level class' }, ...classOptions(tree).filter((option) => !excluded.has(option.value))]}
            onChange={(event) => touch(() => setParentKey(event.currentTarget.value))}
          />
        </FormField>
        {editing ? null : (
          <FormField label="Description" optional id={IDS.description} counter={{ max: 2000 }}>
            <Textarea rows={2} value={description} maxLength={2000} onChange={(event) => touch(() => setDescription(event.currentTarget.value))} />
          </FormField>
        )}
      </FormSection>

      <FormSection title="Attributes" headingLevel={3} description="The details each item of this class carries. Items are checked against them when they are saved.">
        {inherited.status === 'loading' ? (
          <SkeletonText lines={2} />
        ) : inherited.status === 'failed' ? (
          <InlineAlert tone="warning">
            Couldn’t load what the parent class passes down.{' '}
            <Button variant="ghost" size="sm" onClick={() => setReload((value) => value + 1)}>
              Try again
            </Button>
          </InlineAlert>
        ) : inherited.list.length > 0 ? (
          <div className="app-CmdbInherited">
            <p className="app-CmdbForm__hint">From {classes.find((row) => row.key === parentKey)?.name ?? 'the parent class'}:</p>
            <ul className="app-CmdbInherited__list">
              {inherited.list.map((attribute) => (
                <li key={attribute.key}>
                  {attribute.label} <span className="app-CmdbForm__hint">· {typeLabel(attribute.type)}{attribute.required ? ' · required' : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {errors.attributes ? <InlineAlert tone="danger">{errors.attributes}</InlineAlert> : null}
        {!ownLoaded ? (
          <SkeletonText lines={3} />
        ) : (
          <ol className="app-CmdbAttributes">
            {rows.map((row, index) => (
              <li key={row.rowId} className="app-CmdbAttribute" id={`attribute-${row.rowId}`} tabIndex={-1}>
                <div className="app-CmdbAttribute__head">
                  <span className="app-CmdbAttribute__number">Attribute {index + 1}</span>
                  {row.saved ? (
                    <span className="app-CmdbForm__hint">Saved: its key and type are fixed.</span>
                  ) : (
                    <IconButton icon="x" size="sm" variant="ghost" label={`Remove ${row.label.trim() || `attribute ${index + 1}`}`} onClick={() => touch(() => setRows((list) => list.filter((entry) => entry.rowId !== row.rowId)))} />
                  )}
                </div>
                <div className="app-CmdbAttribute__fields">
                  <FormField label="Label" {...(errors[row.rowId] ? { error: errors[row.rowId] } : {})}>
                    <Input
                      value={row.label}
                      maxLength={120}
                      autoComplete="off"
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        touch(() => setRows((list) => list.map((entry) => (entry.rowId === row.rowId ? { ...entry, label, ...(entry.keyEdited ? {} : { key: attributeKeyFor(label) }) } : entry))));
                      }}
                    />
                  </FormField>
                  {row.saved ? (
                    <p className="app-CmdbForm__fixed">
                      <span className="app-CmdbForm__fixedLabel">Key</span> <code className="app-CmdbMono">{row.key}</code> · {typeLabel(row.type)}
                    </p>
                  ) : (
                    <>
                      <FormField label="Key" hint="Made from the label.">
                        <Input
                          value={row.key}
                          maxLength={64}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => {
                            const next = event.currentTarget.value;
                            touch(() => setRows((list) => list.map((entry) => (entry.rowId === row.rowId ? { ...entry, key: next, keyEdited: true } : entry))));
                          }}
                        />
                      </FormField>
                      <FormField label="Type">
                        <Select
                          value={row.type}
                          options={TYPES.map((type) => ({ value: type.value, label: type.label }))}
                          onChange={(event) => {
                            const type = event.currentTarget.value as CiAttribute['type'];
                            touch(() => setRows((list) => list.map((entry) => (entry.rowId === row.rowId ? { ...entry, type } : entry))));
                          }}
                        />
                      </FormField>
                    </>
                  )}
                </div>
                {row.type === 'enum' ? (
                  <FormField label="Options" hint="One per line.">
                    <Textarea
                      rows={3}
                      value={row.options}
                      onChange={(event) => {
                        const options = event.currentTarget.value;
                        touch(() => setRows((list) => list.map((entry) => (entry.rowId === row.rowId ? { ...entry, options } : entry))));
                      }}
                    />
                  </FormField>
                ) : null}
                <Checkbox
                  label="Required"
                  description={row.saved && !row.required ? 'Items without a value will need one on their next edit.' : undefined}
                  checked={row.required}
                  onChange={(event) => {
                    const required = event.currentTarget.checked;
                    touch(() => setRows((list) => list.map((entry) => (entry.rowId === row.rowId ? { ...entry, required } : entry))));
                  }}
                />
              </li>
            ))}
          </ol>
        )}
        <div>
          <Button variant="secondary" size="sm" iconStart="plus" onClick={() => touch(() => setRows((list) => [...list, newRow()]))}>
            Add attribute
          </Button>
        </div>
      </FormSection>
    </form>
  );
}

/** A stable text form of the rows, to tell whether the attributes changed. */
function JSONish(rows: readonly Row[]): string {
  return rows.map((row) => [row.key, row.label.trim(), row.type, row.required ? 1 : 0, row.options.trim()].join('\u0001')).join('\u0002');
}
