'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Stepper, type StepperStep } from '../display/Stepper.js';
import { DescriptionList } from '../display/DescriptionList.js';
import { ProgressBar } from '../feedback/ProgressBar.js';
import { FormErrorSummary } from '../formkit/FormErrorSummary.js';
import { useStuck } from '../formkit/sticky.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { VisuallyHidden } from '../web/VisuallyHidden.js';
import { fieldId, renderElement, type FieldRenderContext, type HeadingLevel, type UserOption } from './fields.js';
import { buildEvalContext, validateForm, type FormErrors, type FormEvalExtras } from './logic.js';
import type { FormDefinition, FormValue, FormValues } from './schema.js';
import { stepAnswers, stepFields, visibleSteps, type FormStep } from './steps.js';

export type { UserOption } from './fields.js';

/** Where a steps-mode form is, as `onStepChange` reports it. */
export interface FormStepChange {
  /** 0-based; the review is the last. */
  readonly index: number;
  /** The section's id, `:details` for the loose questions, `:review` for the review. */
  readonly id: string;
  readonly title: string;
  /** Steps including the review. */
  readonly total: number;
  readonly review: boolean;
}

export interface FormRendererProps {
  readonly definition: FormDefinition;
  readonly values: FormValues;
  readonly onChange: (values: FormValues) => void;
  /** Validation results, from `validateForm` or from the API's 422 response. */
  readonly errors?: FormErrors;
  /** Everything a condition may read besides the answers themselves. */
  readonly context?: FormEvalExtras;
  /**
   * The directory search behind every `user` field. Injected, because the
   * design system must not know about the SDK, the session or tenancy.
   */
  readonly loadUsers?: (query: string, signal: AbortSignal) => Promise<readonly UserOption[]>;
  /** Names for user ids already in `values`, so an existing submission shows names rather than ids. */
  readonly userLabels?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
  readonly locale?: string;
  readonly className?: string;
  /**
   * `single` (default): every question on one page. `steps`: each top-level
   * section is a step, the loose questions a first step named after the
   * item, then a review — with each step checked before the next.
   */
  readonly mode?: 'single' | 'steps';
  /** The level of the top headings (sections; in steps mode, each step's). Default 2, under the page's `h1`. */
  readonly headingLevel?: 2 | 3;
  /** Client only. Steps mode: told whenever the step changes. */
  readonly onStepChange?: (step: FormStepChange) => void;
  /** Steps mode: the item being requested, which names the first step. Defaults to the definition's title. */
  readonly title?: string;
  /** Steps mode: the final button, which repeats the verb ("Request System access"). Default "Send request". */
  readonly submitLabel?: string;
  /** Steps mode: the request is being sent (the final button shows it). */
  readonly submitting?: boolean;
  /** Steps mode: why sending is unavailable right now ("Requests can't be sent offline…"), a state gate (D19). */
  readonly submitDisabledReason?: string;
  /**
   * Client only. Steps mode: called by the final button once every answer
   * checks out. Without it the button is a `type="submit"` for the form the
   * renderer sits in.
   */
  readonly onSubmit?: () => void;
}

const NO_ERRORS: FormErrors = Object.freeze({});
const NO_EXTRAS: FormEvalExtras = Object.freeze({});
const NO_LABELS: Readonly<Record<string, string>> = Object.freeze({});
const REVIEW_ID = ':review';

/**
 * Renders a form definition.
 *
 * One implementation for the portal, the mobile app (through the native
 * component set) and the admin preview: a builder's preview that differs from
 * what the requester sees is a preview nobody can trust.
 *
 * Every question is a labelled control with its help as a description; a
 * read-only question is read-only, not disabled — focusable, selectable, not
 * faded (01 §5.7); a lone checkbox has its hint and error wired to it.
 * `mode="steps"` turns the same definition into a guided sequence (see
 * `FormSteps` below) without any change to the schema.
 */
export function FormRenderer({
  definition,
  values,
  onChange,
  errors = NO_ERRORS,
  context: extras = NO_EXTRAS,
  loadUsers,
  userLabels = NO_LABELS,
  disabled = false,
  locale = 'en-GB',
  className,
  mode = 'single',
  headingLevel = 2,
  onStepChange,
  title,
  submitLabel,
  submitting = false,
  submitDisabledReason,
  onSubmit,
}: FormRendererProps): ReactNode {
  const baseId = useStableId('itsm-form');
  // Names of users chosen in this session, so the picker can show a label for a
  // value it has just set without another round trip.
  const [resolvedUsers, setResolvedUsers] = useState<Readonly<Record<string, string>>>({});

  // Rebuilt whenever an answer changes: every condition in the form is a
  // function of the current answers, so this is the form's whole state machine.
  const evalContext = useMemo(() => buildEvalContext(values, extras), [values, extras]);

  const setValue = useCallback(
    (field: string, value: FormValue) => {
      onChange({ ...values, [field]: value });
    },
    [onChange, values],
  );

  const rememberUser = useCallback((id: string, name: string) => {
    setResolvedUsers((current) => (current[id] === name ? current : { ...current, [id]: name }));
  }, []);

  const ctx: FieldRenderContext = {
    definition,
    values,
    setValue,
    errors,
    evalContext,
    baseId,
    disabled,
    locale,
    ...(loadUsers ? { loadUsers } : {}),
    userName: (id) => resolvedUsers[id] ?? userLabels[id] ?? id,
    rememberUser,
  };

  if (mode === 'steps') {
    return (
      <FormSteps
        ctx={ctx}
        extras={extras}
        className={className}
        headingLevel={headingLevel}
        title={title ?? definition.title ?? 'Details'}
        submitLabel={submitLabel ?? 'Send request'}
        submitting={submitting}
        submitDisabledReason={submitDisabledReason}
        onSubmit={onSubmit}
        onStepChange={onStepChange}
      />
    );
  }

  return (
    <div className={cx('itsm-FormRenderer', className)} data-mode="single">
      {/* A misconfigured form is not the requester's fault and not theirs to
          fix, so it says so at the top rather than rendering fields that behave
          unpredictably. `validateForm` returns this under `_form` when a
          condition cannot be evaluated at all (ADR-0021). */}
      {errors._form ? (
        <p className="itsm-FormRenderer__error" role="alert">
          {errors._form}
        </p>
      ) : null}
      {definition.ui.elements.map((element) => renderElement(element, ctx, headingLevel))}
    </div>
  );
}

interface FormStepsProps {
  readonly ctx: FieldRenderContext;
  readonly extras: FormEvalExtras;
  readonly className: string | undefined;
  readonly headingLevel: 2 | 3;
  readonly title: string;
  readonly submitLabel: string;
  readonly submitting: boolean;
  readonly submitDisabledReason: string | undefined;
  readonly onSubmit: (() => void) | undefined;
  readonly onStepChange: ((step: FormStepChange) => void) | undefined;
}

function pick(errors: FormErrors, fields: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const message = errors[field];
    if (message) out[field] = message;
  }
  return out;
}

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The steps mode (SPEC §4.4, §6.3 "Request a service", C §3.5).
 *
 * - **Steps** come from the definition (`steps.ts`): the loose questions
 *   first, named after the item, then one step per top-level section, then a
 *   review. A section that an answer hides is a step that is skipped.
 * - **Where you are**: each step's heading says "Step 2 of 3" before its
 *   title, and takes focus when the step changes, so a screen reader starts
 *   the new step at its name; a progress bar (narrow) or a step list (wide)
 *   shows the same thing at a glance.
 * - **Continue checks this step only**, with `validateForm` — the contract's
 *   own validation, the one the API runs — limited to the step's visible
 *   questions. Problems are listed in a `FormErrorSummary` at the top of the
 *   step, which takes focus; each message also sits under its field, and goes
 *   as soon as that field is edited. Enter in a field continues rather than
 *   submitting the page's form.
 * - **Review** lists every answer by step, formatted as a sentence would say
 *   it (a date in the reader's locale, a person's name), each group with an
 *   Edit that returns to the step and then straight back to the review.
 * - **Sending** checks every step again; a problem anywhere returns to the
 *   first step that has one. The API's own field errors (a 422) do the same
 *   when they arrive through `errors`.
 */
function FormSteps({
  ctx,
  extras,
  className,
  headingLevel,
  title,
  submitLabel,
  submitting,
  submitDisabledReason,
  onSubmit,
  onStepChange,
}: FormStepsProps): ReactNode {
  const { definition, values, evalContext, baseId, disabled, locale } = ctx;
  const serverErrors = ctx.errors;
  const steps = visibleSteps(definition, evalContext, title);
  const total = steps.length + 1;

  const [position, setPosition] = useState<{ readonly id: string; readonly index: number }>(() => ({ id: steps[0]?.id ?? REVIEW_ID, index: 0 }));
  const [clientErrors, setClientErrors] = useState<FormErrors>(NO_ERRORS);
  /** Fields edited since the server's errors arrived: their old messages no longer apply. */
  const [edited, setEdited] = useState<ReadonlySet<string>>(() => new Set());
  const [returnToReview, setReturnToReview] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const focusTarget = useRef<'heading' | 'summary' | null>(null);
  const { sentinelRef, stuck } = useStuck(true);

  // Where we are: by id, so a step appearing or disappearing before this one
  // does not move the person; by index when their own step has gone.
  let index = position.id === REVIEW_ID ? steps.length : steps.findIndex((step) => step.id === position.id);
  if (index < 0) index = Math.min(position.index, steps.length);
  const onReview = index === steps.length;
  const step: FormStep | undefined = steps[index];
  const currentId = onReview ? REVIEW_ID : (step?.id ?? REVIEW_ID);
  const currentTitle = onReview ? 'Review your answers' : (step?.title ?? '');

  const go = (target: number, focus: 'heading' | 'summary' = 'heading'): void => {
    const clamped = Math.max(0, Math.min(target, steps.length));
    setPosition({ id: clamped === steps.length ? REVIEW_ID : steps[clamped]!.id, index: clamped });
    focusTarget.current = focus;
  };

  // The step changed: tell the caller.
  const reported = useRef(currentId);
  useEffect(() => {
    if (reported.current === currentId) return;
    reported.current = currentId;
    onStepChange?.({ index, id: currentId, title: onReview ? 'Review' : currentTitle, total, review: onReview });
  }, [currentId, index, onReview, currentTitle, total, onStepChange]);

  // Focus follows the step: its heading, or the summary of what stopped it.
  useBrowserLayoutEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    const node = target === 'summary' ? (summaryRef.current ?? headingRef.current) : headingRef.current;
    node?.focus();
  });

  // The API's field errors arrived (a 422): start again from the first step that has one.
  const seenServerErrors = useRef(serverErrors);
  useEffect(() => {
    if (seenServerErrors.current === serverErrors) return;
    seenServerErrors.current = serverErrors;
    setEdited(new Set());
    const fields = Object.keys(serverErrors).filter((key) => key !== '_form');
    if (fields.length === 0) return;
    const target = steps.findIndex((candidate) => stepFields(candidate, evalContext).some((field) => fields.includes(field.field)));
    setAttempt((count) => count + 1);
    if (target >= 0) {
      setReturnToReview(true);
      go(target, 'summary');
    }
    // `steps` and `go` are this render's; the errors object is the trigger.
  }, [serverErrors]);

  // What is shown: the server's messages for fields not edited since, and this form's own.
  const shownErrors = useMemo<FormErrors>(() => {
    const out: Record<string, string> = {};
    for (const [field, message] of Object.entries(serverErrors)) if (field === '_form' || !edited.has(field)) out[field] = message;
    return { ...out, ...clientErrors };
  }, [serverErrors, edited, clientErrors]);

  const setValue = (field: string, value: FormValue): void => {
    ctx.setValue(field, value);
    setEdited((current) => (current.has(field) ? current : new Set(current).add(field)));
    setClientErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const stepCtx: FieldRenderContext = { ...ctx, errors: shownErrors, setValue };

  /** The first step (index) with a problem among these errors, or -1. */
  const firstStepWith = (errors: FormErrors): number =>
    steps.findIndex((candidate) => stepFields(candidate, evalContext).some((field) => Boolean(errors[field.field])));

  const allFieldNames = (): string[] => steps.flatMap((candidate) => stepFields(candidate, evalContext).map((field) => field.field));

  const proceed = (): void => {
    const all = validateForm(definition, values, extras);
    if (all._form) {
      setClientErrors({ _form: all._form });
      return;
    }
    if (step) {
      const here = pick(all, stepFields(step, evalContext).map((field) => field.field));
      if (Object.keys(here).length > 0) {
        setClientErrors((current) => ({ ...current, ...here }));
        setAttempt((count) => count + 1);
        focusTarget.current = 'summary';
        return;
      }
    }
    if (returnToReview) {
      const elsewhere = firstStepWith(all);
      if (elsewhere >= 0) {
        setClientErrors(pick(all, allFieldNames()));
        setAttempt((count) => count + 1);
        go(elsewhere, 'summary');
        return;
      }
      setReturnToReview(false);
      go(steps.length);
      return;
    }
    go(index + 1);
  };

  // Enter in a field continues, a tick after the event, so a value the field
  // settles on Enter (a typed date) has reached `values` first.
  const proceedRef = useRef(proceed);
  proceedRef.current = proceed;

  const send = (event: MouseEvent<HTMLButtonElement>): void => {
    const all = validateForm(definition, values, extras);
    if (all._form) {
      event.preventDefault();
      setClientErrors({ _form: all._form });
      return;
    }
    const target = firstStepWith(all);
    if (target >= 0) {
      event.preventDefault();
      setClientErrors(pick(all, allFieldNames()));
      setAttempt((count) => count + 1);
      setReturnToReview(true);
      go(target, 'summary');
      return;
    }
    if (onSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing || onReview) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || ['submit', 'button', 'reset', 'image'].includes(target.type)) return;
    // Enter in a field would submit the page's form from the first step.
    event.preventDefault();
    setTimeout(() => proceedRef.current(), 0);
  };

  const Heading = `h${headingLevel}` as const;
  const GroupHeading = `h${headingLevel + 1}` as 'h3' | 'h4';
  const childLevel = (headingLevel + 1) as HeadingLevel;

  // The summary lists this step's problems, linked to their fields.
  const currentFields = step ? stepFields(step, evalContext) : [];
  const summary =
    attempt > 0
      ? currentFields
          .filter((field) => shownErrors[field.field])
          .map((field) => ({ fieldId: fieldId(baseId, field.field), message: shownErrors[field.field]! }))
      : [];
  const stepsWithErrors = new Set(
    attempt > 0 ? steps.filter((candidate) => stepFields(candidate, evalContext).some((field) => shownErrors[field.field])).map((candidate) => candidate.id) : [],
  );

  const stepperSteps: StepperStep[] = [
    ...steps.map<StepperStep>((candidate, position) => ({
      id: candidate.id,
      label: candidate.title,
      status: position === index ? 'current' : stepsWithErrors.has(candidate.id) ? 'error' : position < index ? 'complete' : 'upcoming',
    })),
    { id: REVIEW_ID, label: 'Review', status: onReview ? 'current' : 'upcoming' },
  ];

  const format = { locale, userName: ctx.userName };

  return (
    <div ref={rootRef} className={cx('itsm-FormRenderer', className)} data-mode="steps" onKeyDown={onKeyDown}>
      {shownErrors._form ? (
        <p className="itsm-FormRenderer__error" role="alert">
          {shownErrors._form}
        </p>
      ) : null}

      <div className="itsm-FormRenderer__progress">
        <Stepper className="itsm-FormRenderer__stepper" label="Steps" size="sm" steps={stepperSteps} />
        <ProgressBar className="itsm-FormRenderer__progressBar" value={(index + 1) / total} label={`Step ${index + 1} of ${total}`} labelHidden />
      </div>

      <div key={currentId} className="itsm-FormRenderer__step">
        {summary.length > 0 ? <FormErrorSummary ref={summaryRef} errors={summary} autoFocus={false} headingLevel={headingLevel} /> : null}

        <Heading ref={headingRef} tabIndex={-1} className="itsm-FormRenderer__stepHeading">
          <span className="itsm-FormRenderer__stepCount">
            Step {index + 1} of {total}
            <VisuallyHidden>: </VisuallyHidden>
          </span>
          <span className="itsm-FormRenderer__stepTitle">{currentTitle}</span>
        </Heading>

        {onReview ? (
          <Review
            steps={steps}
            ctx={stepCtx}
            format={format}
            GroupHeading={GroupHeading}
            onEdit={(target) => {
              setReturnToReview(true);
              go(target);
            }}
          />
        ) : step ? (
          <>
            {step.description ? <p className="itsm-FormRenderer__stepDescription">{step.description}</p> : null}
            {step.elements.map((element) => renderElement(element, stepCtx, childLevel))}
          </>
        ) : null}
      </div>

      <div className="itsm-FormRenderer__actions" data-stuck={stuck ? '' : undefined}>
        {index > 0 ? (
          <Button variant="secondary" iconStart="chevron-left" disabled={disabled || submitting} onClick={() => go(index - 1)}>
            Back
          </Button>
        ) : null}
        <div className="itsm-FormRenderer__actionsEnd">
          {onReview ? (
            <Button
              variant="primary"
              type={onSubmit ? 'button' : 'submit'}
              loading={submitting}
              disabled={disabled && !submitting}
              {...(submitDisabledReason ? { disabledReason: submitDisabledReason } : {})}
              onClick={send}
            >
              {submitLabel}
            </Button>
          ) : (
            <Button variant="primary" disabled={disabled} onClick={proceed}>
              {returnToReview ? 'Review answers' : 'Continue'}
            </Button>
          )}
        </div>
      </div>
      <div ref={sentinelRef} className="itsm-FormRenderer__sentinel" aria-hidden="true" />
    </div>
  );
}

interface ReviewProps {
  readonly steps: readonly FormStep[];
  readonly ctx: FieldRenderContext;
  readonly format: { readonly locale: string; readonly userName: (id: string) => string };
  readonly GroupHeading: 'h3' | 'h4';
  readonly onEdit: (index: number) => void;
}

/** Every answer, grouped by the step it was given on, each group with its way back. */
function Review({ steps, ctx, format, GroupHeading, onEdit }: ReviewProps): ReactNode {
  const { definition, values, evalContext } = ctx;
  const groups = steps
    .map((step, index) => ({ step, index, questions: stepFields(step, evalContext).length, answers: stepAnswers(step, definition, values, evalContext, format) }))
    .filter((group) => group.questions > 0);

  if (groups.length === 0) {
    return <p className="itsm-FormRenderer__reviewIntro">There is nothing to fill in. Send it and we will take it from there.</p>;
  }

  return (
    <>
      <p className="itsm-FormRenderer__reviewIntro">Check your answers, then send your request.</p>
      {groups.map(({ step, index, answers }) => (
        <div key={step.id} className="itsm-FormRenderer__reviewGroup">
          <div className="itsm-FormRenderer__reviewHeader">
            <GroupHeading className="itsm-FormRenderer__reviewTitle">{step.title}</GroupHeading>
            <Button variant="ghost" size="sm" iconStart="pencil" onClick={() => onEdit(index)}>
              Edit<VisuallyHidden> {step.title}</VisuallyHidden>
            </Button>
          </div>
          {answers.length > 0 ? (
            <DescriptionList
              className="itsm-FormRenderer__answers"
              layout="inline"
              items={answers.map((answer) => ({
                id: answer.field,
                label: answer.label,
                value: <span className="itsm-FormRenderer__answer">{answer.text}</span>,
              }))}
            />
          ) : (
            <p className="itsm-FormRenderer__reviewEmpty">No answers given.</p>
          )}
        </div>
      ))}
    </>
  );
}
