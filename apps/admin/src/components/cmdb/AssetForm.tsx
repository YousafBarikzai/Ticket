'use client';

import { useState, type ReactNode } from 'react';
import type { AssetInput, AssetRow } from '@itsm/sdk';
import { FormErrorSummary, FormField, FormSection, Input } from '@itsm/ui';
import { Combobox, DatePicker, type ComboboxOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useMutation } from '../../client/useMutation.js';
import { CI_STATUS_LOOK, lookOf, type AssetView } from './presentation.js';

/**
 * An asset's fields, for *Add asset* and for *Edit* in its drawer (SPEC §6.1
 * `/cmdb/assets`): its tag (allocated when left empty), serial, make and
 * model, purchase, warranty, supplier, cost centre, location and the
 * configuration item it is.
 *
 * An edit sends only what changed. The API keeps a value it is not sent and
 * cannot clear one once recorded, so a field that held a value says so
 * rather than appearing to clear and silently not. Make, model and purchase
 * cost are recorded when the asset is added; the register does not show
 * them back, so they are not offered for editing.
 */

export interface AssetFormProps {
  readonly formId: string;
  readonly asset?: AssetView;
  /** The linked item's name, for an edit. */
  readonly ciName?: string | null;
  readonly takenTags: readonly string[];
  /** Whether this person can search configuration items to link one. */
  readonly canLinkCi: boolean;
  onDirtyChange(dirty: boolean): void;
  onBusyChange(busy: boolean): void;
  onDone(saved: AssetRow | null): void;
}

const IDS = {
  tag: 'asset-tag',
  serial: 'asset-serial',
  manufacturer: 'asset-manufacturer',
  model: 'asset-model',
  purchasedOn: 'asset-purchased',
  purchaseCost: 'asset-cost',
  currency: 'asset-currency',
  warrantyEndsOn: 'asset-warranty',
  supplier: 'asset-supplier',
  costCentre: 'asset-cost-centre',
  location: 'asset-location',
  ciId: 'asset-ci',
} as const;

type Field = keyof typeof IDS;

/** The text fields an edit may change, as the API names them. */
const TEXT_FIELDS = ['serial', 'supplier', 'costCentre', 'location'] as const;

const CANT_CLEAR = 'Once recorded this can’t be removed, only changed.';

export function AssetForm({ formId, asset, ciName, takenTags, canLinkCi, onDirtyChange, onBusyChange, onDone }: AssetFormProps): ReactNode {
  const [values, setValues] = useState<Record<Field, string>>({
    tag: '',
    serial: asset?.serial ?? '',
    manufacturer: '',
    model: '',
    purchasedOn: asset?.purchasedOn ?? '',
    purchaseCost: '',
    currency: 'GBP',
    warrantyEndsOn: asset?.warrantyEndsOn ?? '',
    supplier: asset?.supplier ?? '',
    costCentre: asset?.costCentre ?? '',
    location: asset?.location ?? '',
    ciId: asset?.ciId ?? '',
  });
  const [ci, setCi] = useState<ComboboxOption | null>(asset?.ciId ? { value: asset.ciId, label: ciName ?? 'Linked item' } : null);
  const [errors, setErrors] = useState<Readonly<Partial<Record<Field, string>>>>({});
  const [attempt, setAttempt] = useState(0);

  const set = (field: Field, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    onDirtyChange(true);
  };

  const save = useMutation(
    async (input: { readonly create?: AssetInput; readonly tag?: string; readonly patch?: Omit<AssetInput, 'tag'> }) => {
      if (input.create) return api.observe.estate.createAsset(input.create);
      if (input.tag && input.patch) return api.observe.estate.updateAsset(input.tag, input.patch);
      return null;
    },
    {
      success: (saved) => (saved ? (asset ? `${saved.tag} saved` : `${saved.tag} added`) : 'Nothing changed'),
      failure: asset ? 'Couldn’t save the asset' : 'Couldn’t add the asset',
      // A new asset's sheet gives way to its drawer (a URL change); its caller refreshes after that.
      refresh: asset !== undefined,
    },
  );

  const submit = async (): Promise<void> => {
    const found: Partial<Record<Field, string>> = {};
    const text = (field: Field): string => values[field].trim();
    if (!asset) {
      if (text('tag') && takenTags.includes(text('tag'))) found.tag = 'Another asset already has this tag.';
      if (Boolean(text('manufacturer')) !== Boolean(text('model'))) found[text('manufacturer') ? 'model' : 'manufacturer'] = 'Give both a make and a model, or neither.';
      if (text('purchaseCost')) {
        const cost = Number(text('purchaseCost').replace(/,/g, ''));
        if (!Number.isFinite(cost) || cost < 0) found.purchaseCost = 'Enter the cost as a number, like 1249.99.';
        if (!/^[A-Za-z]{3}$/.test(text('currency'))) found.currency = 'Enter a three-letter currency, like GBP.';
      }
    } else {
      for (const field of TEXT_FIELDS) if (asset[field] && !text(field)) found[field] = CANT_CLEAR;
      if (asset.purchasedOn && !values.purchasedOn) found.purchasedOn = CANT_CLEAR;
      if (asset.warrantyEndsOn && !values.warrantyEndsOn) found.warrantyEndsOn = CANT_CLEAR;
      if (asset.ciId && !ci) found.ciId = 'A linked item can’t be removed, only changed.';
    }
    if (values.purchasedOn && values.warrantyEndsOn && values.warrantyEndsOn < values.purchasedOn) found.warrantyEndsOn = 'The warranty can’t end before the purchase.';
    setErrors(found);
    setAttempt((value) => value + 1);
    if (Object.keys(found).length > 0) return;

    let payload: { create?: AssetInput; tag?: string; patch?: Omit<AssetInput, 'tag'> };
    if (!asset) {
      const create: AssetInput = {
        ...(text('tag') ? { tag: text('tag') } : {}),
        ...(text('serial') ? { serial: text('serial') } : {}),
        ...(text('manufacturer') && text('model') ? { manufacturer: text('manufacturer'), model: text('model') } : {}),
        ...(values.purchasedOn ? { purchasedOn: values.purchasedOn } : {}),
        ...(text('purchaseCost') ? { purchaseCost: Number(text('purchaseCost').replace(/,/g, '')), currency: text('currency').toUpperCase() } : {}),
        ...(values.warrantyEndsOn ? { warrantyEndsOn: values.warrantyEndsOn } : {}),
        ...(text('supplier') ? { supplier: text('supplier') } : {}),
        ...(text('costCentre') ? { costCentre: text('costCentre') } : {}),
        ...(text('location') ? { location: text('location') } : {}),
        ...(ci ? { ciId: ci.value } : {}),
      };
      payload = { create };
    } else {
      const patch: Record<string, unknown> = {};
      for (const field of TEXT_FIELDS) if (text(field) && text(field) !== (asset[field] ?? '')) patch[field] = text(field);
      if (values.purchasedOn && values.purchasedOn !== (asset.purchasedOn ?? '')) patch.purchasedOn = values.purchasedOn;
      if (values.warrantyEndsOn && values.warrantyEndsOn !== (asset.warrantyEndsOn ?? '')) patch.warrantyEndsOn = values.warrantyEndsOn;
      if (ci && ci.value !== (asset.ciId ?? '')) patch.ciId = ci.value;
      if (Object.keys(patch).length === 0) {
        onDirtyChange(false);
        onDone(null);
        return;
      }
      payload = { tag: asset.tag, patch };
    }

    onBusyChange(true);
    const result = await save.run(payload);
    onBusyChange(false);
    if (result.ok) {
      onDirtyChange(false);
      onDone(result.value);
      return;
    }
    const problem = result.problem;
    if (problem.status === 409) {
      // Two conflicts: the tag is on another asset, or the item is already another asset.
      setErrors(/configuration item/i.test(problem.detail ?? '') ? { ciId: 'That item is already another asset. One item is at most one asset.' } : { tag: 'Another asset already has this tag.' });
    } else if (problem.status === 422) {
      const mapped: Partial<Record<Field, string>> = {};
      for (const [path, message] of Object.entries(problem.fieldErrors ?? {})) {
        const field = path.split('.')[0] as Field;
        mapped[field in IDS ? field : 'serial'] ??= message;
      }
      if (Object.keys(mapped).length === 0) mapped[asset ? 'serial' : 'tag'] = problem.detail ?? 'Something in the form isn’t right.';
      setErrors(mapped);
    } else if (problem.status === 404 && ci) setErrors({ ciId: 'That item no longer exists. Choose another.' });
    setAttempt((value) => value + 1);
  };

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: IDS[field as Field], message: message ?? '' }));
  const error = (field: Field): { error?: string } => (errors[field] ? { error: errors[field] } : {});
  const textField = (field: Field, label: string, hint?: string, extra: { readonly optional?: boolean; readonly maxLength?: number; readonly mono?: boolean } = {}): ReactNode => (
    <FormField label={label} optional={extra.optional ?? true} id={IDS[field]} {...(hint ? { hint } : {})} {...error(field)}>
      <Input
        value={values[field]}
        maxLength={extra.maxLength ?? 200}
        autoComplete="off"
        {...(extra.mono ? { spellCheck: false } : {})}
        onChange={(event) => set(field, event.currentTarget.value)}
      />
    </FormField>
  );

  return (
    <form
      id={formId}
      className="app-CmdbForm"
      noValidate
      aria-label={asset ? `Edit ${asset.tag}` : 'New asset'}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}
      <FormSection title="The asset" headingLevel={3}>
        {asset ? (
          <p className="app-CmdbForm__fixed">
            <span className="app-CmdbForm__fixedLabel">Tag</span> <code className="app-CmdbMono">{asset.tag}</code>
            <span className="app-CmdbForm__fixedHint">The label on the asset; it can’t change.</span>
          </p>
        ) : (
          textField('tag', 'Tag', 'The label stuck on it. Leave empty and one is allocated, like AST-00042.', { maxLength: 60, mono: true })
        )}
        {textField('serial', 'Serial number', undefined, { maxLength: 120, mono: true, optional: !asset?.serial })}
        {asset ? null : (
          <div className="app-CmdbForm__pair">
            {textField('manufacturer', 'Make', 'Like “Lenovo”.', { maxLength: 120 })}
            {textField('model', 'Model', 'Like “ThinkPad T14”.', { maxLength: 120 })}
          </div>
        )}
        {canLinkCi ? (
          <FormField label="Configuration item" optional={!asset?.ciId} id={IDS.ciId} hint="The item it is in the CMDB, so the two registers agree." {...error('ciId')}>
            {(control) => (
              <Combobox
                {...control}
                value={ci}
                placeholder="Search items by name"
                emptyMessage="No items match"
                clearable={!asset?.ciId}
                onChange={(next) => {
                  setCi(next);
                  onDirtyChange(true);
                }}
                loadOptions={async (query, signal) => {
                  const rows = await api.observe.estate.cis({ ...(query ? { search: query } : {}), limit: 20 });
                  if (signal.aborted) return [];
                  return rows.map((row) => ({ value: row.id, label: row.name, description: [lookOf(CI_STATUS_LOOK, row.status).label, row.environment].filter(Boolean).join(' · ') }));
                }}
              />
            )}
          </FormField>
        ) : null}
      </FormSection>
      <FormSection title="Purchase and warranty" headingLevel={3}>
        <FormField label="Purchased on" optional={!asset?.purchasedOn} id={IDS.purchasedOn} {...error('purchasedOn')}>
          {(control) => <DatePicker {...control} value={values.purchasedOn || null} onChange={(next) => set('purchasedOn', next ?? '')} />}
        </FormField>
        {asset ? null : (
          <div className="app-CmdbForm__pair">
            <FormField label="Cost" optional id={IDS.purchaseCost} {...error('purchaseCost')}>
              <Input value={values.purchaseCost} inputMode="decimal" autoComplete="off" onChange={(event) => set('purchaseCost', event.currentTarget.value)} />
            </FormField>
            {textField('currency', 'Currency', 'Three letters.', { maxLength: 3, mono: true, optional: !values.purchaseCost.trim() })}
          </div>
        )}
        <FormField label="Warranty ends" optional={!asset?.warrantyEndsOn} id={IDS.warrantyEndsOn} hint="The register warns 30 days before." {...error('warrantyEndsOn')}>
          {(control) => <DatePicker {...control} value={values.warrantyEndsOn || null} onChange={(next) => set('warrantyEndsOn', next ?? '')} />}
        </FormField>
        {textField('supplier', 'Supplier', 'Who it was bought from, or who supports it.', { optional: !asset?.supplier })}
      </FormSection>
      <FormSection title="Where it belongs" headingLevel={3}>
        {textField('costCentre', 'Cost centre', undefined, { maxLength: 60, optional: !asset?.costCentre })}
        {textField('location', 'Location', 'Like “Leeds office, 2nd floor”.', { optional: !asset?.location })}
      </FormSection>
    </form>
  );
}
