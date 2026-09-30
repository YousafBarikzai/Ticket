'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button, FormField, Meter, NumberField, StatusPill, Surface } from '@itsm/ui';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { GB, fromInputUnits, inputUnits, softProblem, type MeterView } from './usage.js';

/**
 * Settings › Usage & plan (SPEC §6.1): the plan this desk is on, and each
 * meter against it — how much is used, the warning line and the plan's
 * limit drawn on one bar, and a state in words when a line has been passed.
 * People with `tenant.limit.manage` move their own warning line ("Warn me
 * at"); the plan's limit is the platform's, and the page says so.
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';

const STATE_LOOK = {
  ok: null,
  warned: { tone: 'warning' as const, label: 'Past the warning line' },
  blocked: { tone: 'danger' as const, label: 'At the plan’s limit' },
};

export interface UsageViewProps {
  readonly meters: readonly MeterView[];
  readonly canEdit: boolean;
  readonly locale: string;
}

export function UsageView({ meters, canEdit, locale }: UsageViewProps): ReactNode {
  return (
    <div className="app-UsageGrid">
      {meters.map((meter) => (
        <MeterCard key={meter.meter} meter={meter} canEdit={canEdit} locale={locale} />
      ))}
    </div>
  );
}

function MeterCard({ meter, canEdit, locale }: { readonly meter: MeterView; readonly canEdit: boolean; readonly locale: string }): ReactNode {
  const labelId = useId();
  const look = STATE_LOOK[meter.state];
  const bytes = meter.unit === 'bytes';
  const scale = (n: number): number => (bytes ? n / GB : n);
  const limit = meter.hard ?? (meter.soft !== null ? Math.max(meter.soft * 1.25, meter.value) : null);
  return (
    <Surface as="section" padding="md" elevation="xs" className="app-UsageMeter" aria-labelledby={labelId} data-state={meter.state}>
      <div className="app-UsageMeter__head">
        <h2 id={labelId} className="app-UsageMeter__label">
          {meter.label}
        </h2>
        <span className="app-UsageMeter__period">{meter.period}</span>
      </div>
      <p className="app-UsageMeter__value">{meter.display}</p>
      {look ? (
        <span className="app-UsageMeter__state">
          <StatusPill size="sm" tone={look.tone} label={look.label} />
        </span>
      ) : null}
      {limit !== null && limit > 0 ? (
        <Meter
          label={`${meter.label} used`}
          value={scale(meter.value)}
          max={scale(limit)}
          {...(meter.soft !== null ? { softLine: scale(meter.soft) } : {})}
          {...(meter.hard !== null ? { hardLine: scale(meter.hard) } : {})}
          format={bytes ? { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }}
          locale={locale}
        />
      ) : null}
      <p className="app-UsageMeter__lines">{meter.lines}</p>
      <p className="app-UsageMeter__description">{meter.description}</p>
      {canEdit ? <WarnAt meter={meter} /> : null}
    </Surface>
  );
}

function WarnAt({ meter }: { readonly meter: MeterView }): ReactNode {
  const online = useOnline();
  const current = inputUnits(meter, meter.soft);
  const [seen, setSeen] = useState(meter.soft);
  const [draft, setDraft] = useState<number | null>(current);
  const [problem, setProblem] = useState<string | null>(null);
  if (seen !== meter.soft) {
    setSeen(meter.soft);
    setDraft(inputUnits(meter, meter.soft));
    setProblem(null);
  }
  const save = useMutation((soft: number | null) => api.tenant.setSoftLimit(meter.meter, soft), {
    success: (result) => (result.soft === null ? `${meter.label}: no warning line` : `${meter.label}: warning line saved`),
    failure: `Couldn’t change the warning line for ${meter.label.toLowerCase()}`,
  });
  const dirty = draft !== current;
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const why = softProblem(meter, draft);
    if (why) {
      setProblem(why);
      return;
    }
    setProblem(null);
    const result = await save.run(fromInputUnits(meter, draft!));
    if (!result.ok && result.problem.detail) setProblem(result.problem.detail);
  };
  return (
    <form className="app-UsageMeter__warn" onSubmit={(event) => void submit(event)} noValidate>
      <FormField label="Warn me at" {...(problem ? { error: problem } : {})} className="app-UsageMeter__field">
        <NumberField
          value={draft}
          onChange={setDraft}
          min={0}
          {...(meter.hard !== null ? { max: inputUnits(meter, meter.hard)! } : {})}
          step={meter.unit === 'calls' || meter.unit === 'tickets' ? 100 : 1}
          unit={meter.unit === 'bytes' ? 'GB' : meter.unit}
          size="sm"
        />
      </FormField>
      <div className="app-UsageMeter__actions">
        {dirty ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDraft(current)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={save.pending} loadingLabel="Saving…" {...(online ? {} : { disabledReason: OFFLINE })}>
              Save
            </Button>
          </>
        ) : meter.soft !== null ? (
          <Button size="sm" variant="ghost" onClick={() => void save.run(null)} {...(online ? {} : { disabledReason: OFFLINE })}>
            Use the plan’s line
          </Button>
        ) : null}
      </div>
    </form>
  );
}
