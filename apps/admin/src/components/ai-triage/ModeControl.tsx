'use client';

import { useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, FormField, InlineAlert, SegmentedControl, StatusPill, Textarea, notify, useItsm } from '@itsm/ui';
import { Dialog } from '@itsm/ui/overlays';
import { useTheme } from '@itsm/ui/theme';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { MODE_LABELS, MODE_SENTENCES, TRIAGE_MODES, modePlan, type ModeState, type ModeStep, type Readiness, type TriageMode } from '../../triage.js';

/**
 * The AI triage mode as a real control (SPEC §6.1 Overview, §6.4 "AI triage
 * mode: one commit control with readiness confirm").
 *
 * A `SegmentedControl` in commit mode — arrows move, Space or Enter picks —
 * that never changes anything by itself: picking a mode opens a confirmation
 * that says what that mode does, what the record says about it (how often
 * the answers were right; which fields have earned auto-apply), exactly what
 * will be written, and an explicit **Apply**. Until then the control stays on
 * the mode the desk is actually in.
 *
 * The backend's rules are described, never added to: Auto may be chosen at
 * any time because each field is applied only once it has earned it, and
 * Auto steps itself back to Suggest when agents correct too much. The
 * tenant-wide AI switch is not this page's to turn on; when it is off, the
 * confirmation says where it is instead of offering Apply.
 */

const MODE_SETTING = 'ai.decision.triage.mode';
const TRIAGE_FLAG = 'ai.decision.triage';
const OFFLINE = 'You’re offline — changes can’t be saved.';

export interface ModeContext {
  readonly state: ModeState;
  readonly readiness: Readiness;
  /** Whole percent: the suggest threshold ("answers at or above 60% confidence"). */
  readonly suggestAt: number;
  /** "5% of the last 100": the step-down rule, from the score's meter. */
  readonly stepDown: { readonly limit: number; readonly window: number };
  /** Settings › AI, when this person may open it: where the tenant-wide switch lives. */
  readonly settingsHref?: string;
}

function title(from: TriageMode, to: TriageMode): string {
  if (to === 'off') return 'Turn off AI triage?';
  if (from === 'off') return `Turn on AI triage in ${MODE_LABELS[to]}?`;
  return `Switch AI triage to ${MODE_LABELS[to]}?`;
}

function stepText(step: ModeStep, showKeys: boolean): string {
  if (step.kind === 'flag') return showKeys ? `Turns the triage switch on (${TRIAGE_FLAG})` : 'Turns the triage switch on';
  return showKeys ? `Sets the triage mode to ${MODE_LABELS[step.value]} (${MODE_SETTING})` : `Sets the triage mode to ${MODE_LABELS[step.value]}`;
}

/** What the record says about the mode being chosen. */
function Evidence({ target, context }: { readonly target: TriageMode; readonly context: ModeContext }): ReactNode {
  const { readiness, suggestAt, stepDown } = context;
  const limit = `${Math.round(stepDown.limit * 100)}%`;
  if (target === 'off') {
    return (
      <p className="app-Mode__text">
        Nothing more is sent anywhere. Decisions already recorded, and their scores, stay here.
        {context.state.effective === 'auto' ? ' Values the AI already set stay as they are.' : ''}
      </p>
    );
  }
  if (target === 'shadow') {
    return <p className="app-Mode__text">Nothing reaches agents. Answers are scored as tickets are resolved, and that record is what Suggest and Auto are judged on.</p>;
  }
  if (target === 'suggest') {
    return (
      <p className="app-Mode__text">
        Agents see answers at or above {suggestAt}% confidence. So far: {readiness.suggest.text.charAt(0).toLowerCase()}
        {readiness.suggest.text.slice(1)}
        {readiness.suggest.text.endsWith('.') ? '' : '.'}
      </p>
    );
  }
  return (
    <div className="app-Mode__evidence">
      <p className="app-Mode__text">{readiness.auto.text}.</p>
      {readiness.auto.fields.length > 0 ? (
        <ul className="app-Mode__fields">
          {readiness.auto.fields.map((field) => (
            <li key={field.question}>
              <StatusPill size="sm" tone={field.eligible ? 'success' : 'neutral'} label={`${field.label}: ${field.text}`} />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="app-Mode__text">
        A field that hasn’t earned it is suggested instead, exactly as in Suggest. If agents correct more than {limit} of the last {stepDown.window} values it set, it switches itself
        back to Suggest and administrators are told.
      </p>
    </div>
  );
}

export function ModeConfirm({ target, context, onClose }: { readonly target: TriageMode | null; readonly context: ModeContext; onClose(): void }): ReactNode {
  const router = useRouter();
  const online = useOnline();
  const noteId = useId();
  const { Link } = useItsm();
  const { prefs } = useTheme();
  const [note, setNote] = useState('');
  const plan = target ? modePlan(context.state, target) : { steps: [] };
  const from = context.state.effective;

  const apply = useMutation(
    async (steps: readonly ModeStep[], reason: string) => {
      const options = reason ? { reason } : {};
      // In order: the mode first, then the switch, so a desk never runs for a moment in a mode it is leaving.
      for (const step of steps) {
        if (step.kind === 'setting') await api.tenant.setSetting(MODE_SETTING, step.value, options);
        else await api.tenant.setFlag(TRIAGE_FLAG, true, options);
      }
    },
    { failure: 'Couldn’t change the AI triage mode' },
  );

  const close = (): void => {
    setNote('');
    apply.reset();
    onClose();
  };

  if (!target) return null;
  const blocked = 'blocked' in plan ? plan.blocked : undefined;

  return (
    <Dialog
      open
      onClose={() => {
        if (!apply.pending) close();
      }}
      size="md"
      title={title(from, target)}
      description={MODE_SENTENCES[target]}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          {blocked ? null : (
            <Button
              variant="primary"
              loading={apply.pending}
              loadingLabel="Applying…"
              {...(!online ? { disabledReason: OFFLINE } : plan.steps.length === 0 ? { disabledReason: `AI triage is already in ${MODE_LABELS[target]}.` } : {})}
              onClick={async () => {
                const result = await apply.run(plan.steps, note.trim());
                if (!result.ok) return;
                notify(target === 'off' ? 'AI triage is off' : `AI triage is in ${MODE_LABELS[target]}`, { tone: 'success', description: MODE_SENTENCES[target] });
                close();
                router.refresh();
              }}
            >
              Apply
            </Button>
          )}
        </>
      }
    >
      <div className="app-Mode__confirm">
        {blocked ? (
          <InlineAlert tone="warning">
            {blocked}
            {context.settingsHref ? (
              <>
                {' '}
                <Link href={context.settingsHref}>Open Settings › AI</Link>
              </>
            ) : null}
          </InlineAlert>
        ) : null}
        <div className="app-Mode__section">
          <Evidence target={target} context={context} />
        </div>
        {!blocked && plan.steps.length > 0 ? (
          <div className="app-Mode__section">
            <h3 id={`${noteId}-writes`} className="app-Mode__heading">
              Apply will
            </h3>
            <ul className="app-Mode__writes">
              {plan.steps.map((step) => (
                <li key={step.kind}>{stepText(step, prefs.showKeys)}</li>
              ))}
            </ul>
            <FormField label="Note for the audit log" optional hint="Why now — it is kept with the change.">
              <Textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
            </FormField>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * The control itself. People who may not change the mode see the mode in
 * words instead — the page header's *View only* pill says why.
 */
export function ModeControl({ context, canChange }: { readonly context: ModeContext; readonly canChange: boolean }): ReactNode {
  const [target, setTarget] = useState<TriageMode | null>(null);
  const mode = context.state.effective;

  return (
    <div className="app-Mode">
      {canChange ? (
        <SegmentedControl
          label="AI triage mode"
          mode="commit"
          size="sm"
          value={mode}
          options={TRIAGE_MODES.map((value) => ({ value, label: MODE_LABELS[value] }))}
          onValueChange={(value) => {
            if (value !== mode) setTarget(value as TriageMode);
          }}
        />
      ) : (
        <StatusPill tone={mode === 'off' ? 'neutral' : 'accent'} label={MODE_LABELS[mode]} srPrefix="Mode" />
      )}
      <p className="app-Mode__sentence">{MODE_SENTENCES[mode]}</p>
      <ModeConfirm target={target} context={context} onClose={() => setTarget(null)} />
    </div>
  );
}

/**
 * AI triage switched off with nothing recorded (SPEC: "AI triage is off.
 * Start in Shadow…"), with *Turn on in Shadow* behind the same confirmation.
 */
export function OffState({ context, canChange }: { readonly context: ModeContext; readonly canChange: boolean }): ReactNode {
  const [target, setTarget] = useState<TriageMode | null>(null);
  return (
    <>
      <EmptyState
        size="lg"
        illustration="setup"
        title="AI triage is off"
        description="Start in Shadow — it suggests nothing to agents and scores itself against their choices."
        {...(canChange ? { action: { id: 'shadow', label: 'Turn on in Shadow', variant: 'primary' as const } } : {})}
        onAction={() => setTarget('shadow')}
      />
      <ModeConfirm target={target} context={context} onClose={() => setTarget(null)} />
    </>
  );
}
