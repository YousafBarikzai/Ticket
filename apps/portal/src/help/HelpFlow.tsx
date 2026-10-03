'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { queueable, type Article, type SearchHit } from '@itsm/sdk';
import { newIdempotencyKey, submitOrQueue } from '@itsm/pwa';
import {
  announce,
  asRichBlocks,
  Button,
  DraftNotice,
  DraftStatus,
  FormErrorSummary,
  FormField,
  Icon,
  IconTile,
  Input,
  notify,
  Prose,
  RadioGroup,
  RichText,
  Spinner,
  Stepper,
  Textarea,
  useDraft,
  VisuallyHidden,
} from '@itsm/ui';
import { api } from '../client/api.js';
import { articleHref } from '../client/palette.js';
import { reportSessionEnded } from '../client/useAction.js';
import { URGENCY_CHOICES } from '../tickets/presentation.js';
import { renderSentPanel } from './actions.js';
import { useKnownIssues } from './known-issues.js';
import {
  DETAILS_MAX,
  EMPTY_DRAFT,
  HELP_CAN_ALL,
  TITLE_MAX,
  draftKey,
  isEmptyDraft,
  isUrgency,
  matchingIssues,
  readReportDraft,
  sendFailureMessage,
  sendProblemOf,
  splitDescription,
  URGENCY_LOOK,
  validateReport,
  type HelpCan,
  type HelpStep,
  type KnownIssue,
  type ReportDraft,
  type Urgency,
} from './model.js';
import { KnownIssueCallout, Suggested } from './Suggested.js';
import { useSuggestions } from './suggestions.js';

/**
 * "How can we help?" — the portal's one way in to getting help (SPEC D17,
 * §6.3, X-40, §6.4; v3 §7.2, X-M12): one flow, three steps under a small
 * `Stepper` (Describe · Details · Review).
 *
 *   1. **Describe.** One field, "What do you need help with?". Typing pauses
 *      for 300 ms, then what might already answer it appears underneath:
 *      help articles (opened here, with *This solved it*), services, their
 *      own requests that sound the same — and, when an open incident sounds
 *      like it, "Is it this?". The way on is always there:
 *      *Continue — report this as an issue*.
 *   2. **Details.** The title (from what they typed), optional details, and
 *      how much it is holding them up, in their words, as cards with a tile
 *      and what the choice means. Never a priority, a category or an impact:
 *      the desk sets those.
 *   3. **Review.** What will be sent, as a definition list, with Edit; then
 *      *Send report*.
 *
 * Then a clear ending: the success panel, drawn on the server
 * (`renderSentPanel`: "Request sent · INC-000124 · We'll reply by 14:00" and
 * what happens next), or — when the panel cannot be had — "We've got it ·
 * INC-000124" in the flow's own words; or, with no network, "Saved on this
 * device. We'll send it when you're back online." No step offers to attach
 * a file: the product has no upload control (v3 RV4).
 *
 * **One intent, one key.** The idempotency key is minted when *Send report*
 * is first pressed and reused for that same report online, in the offline
 * queue and on every retry after a failure, so a response lost on the way
 * back can never become a second ticket. Editing the report makes it a new
 * intent, with a new key (the API refuses a known key with a new body).
 *
 * **Nothing typed is lost.** The draft is kept on this device every five
 * seconds (`itsm-draft:report:<user>`), written when the flow closes or the
 * tab hides, restored with "Draft restored · Discard", and cleared once the
 * report is sent or queued. A session that ends mid-send keeps it for after
 * signing in again.
 *
 * The same component is the sheet (the frame's *New request*, "Report 'x'
 * as an issue", "Report it again") and the `/report` page: it draws its
 * parts — title, body, footer — and the caller puts them in a sheet or on a
 * page.
 */

export type HelpPhase = HelpStep | 'sent' | 'queued';

export interface HelpFlowStart {
  /** Never the review: a flow opened elsewhere starts where there is something to write. */
  readonly step?: Exclude<HelpStep, 'review'>;
  /** What they typed elsewhere: step 1's field, or step 2's title. */
  readonly text?: string;
  /** Step 2's details, already begun ("Related to INC-000123"). */
  readonly details?: string;
}

export interface HelpFlowParts {
  /** The sheet's title for this step. */
  readonly title: string;
  /** "Step 1 of 3 · Describe it", while there are steps. */
  readonly stepLabel?: string;
  readonly body: ReactNode;
  readonly footer: ReactNode;
  /** Where focus starts when the flow opens. */
  readonly initialFocusRef: RefObject<HTMLElement | null>;
  readonly phase: HelpPhase;
}

export interface HelpFlowProps {
  /** The signed-in person (their draft is theirs alone). No person, no draft. */
  readonly userId: string | null;
  readonly can?: HelpCan;
  readonly start?: HelpFlowStart;
  /** Open incidents, when the page read them; otherwise what the last page that did published. */
  readonly knownIssues?: { readonly issues: readonly KnownIssue[]; readonly followUrl: string | null };
  /** `sheet`: headings under the sheet's title (h3). `page`: under the page's H1 (h2). */
  readonly variant: 'sheet' | 'page';
  /** Done, or an answer solved it: the sheet closes, the page goes Home. */
  readonly onClose: () => void;
  readonly children: (parts: HelpFlowParts) => ReactNode;
}

interface SentOutcome {
  readonly number: string | null;
  /** The server's success panel, or `null` when it could not be had (the flow's own words stand in). */
  readonly panel: ReactNode;
}

interface OpenAnswer {
  readonly hit: SearchHit;
  readonly article: Article | null;
  readonly failed: boolean;
}

/** The Stepper's three steps, in order. */
const STEPS: readonly { readonly id: HelpStep; readonly label: string; readonly lead: string }[] = [
  { id: 'describe', label: 'Describe', lead: 'Describe it' },
  { id: 'details', label: 'Details', lead: 'Add the details' },
  { id: 'review', label: 'Review', lead: 'Check and send' },
];

/** "Step 2 of 3 · Add the details". */
export function stepLabelFor(step: HelpStep): string {
  const index = STEPS.findIndex((candidate) => candidate.id === step);
  return `Step ${index + 1} of ${STEPS.length} · ${STEPS[index]!.lead}`;
}

/**
 * The server's panel for a number, or `null` — after `SENT_PANEL_TIMEOUT_MS`
 * (help/sent.ts, written out here: shared with the request flow, the constant
 * would be a module of its own on `/catalogue/[key]`) at the latest, so a
 * slow or unreachable server never holds the ending up.
 */
function drawSent(number: string, headingLevel: 2 | 3): Promise<ReactNode> {
  return Promise.race([
    renderSentPanel({ number, kind: 'issue', headingLevel }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
  ]);
}

function initialDraft(start: HelpFlowStart | undefined): ReportDraft {
  const text = start?.text?.trim() ?? '';
  const details = start?.details?.trim() ?? '';
  if (start?.step === 'details') {
    const split = splitDescription(text);
    return { ...EMPTY_DRAFT, step: 'details', text, title: split.title, details: [details, split.details].filter(Boolean).join('\n\n') };
  }
  return { ...EMPTY_DRAFT, text, details };
}

function useFocusOnChange(ref: RefObject<HTMLElement | null>, key: unknown, when: boolean): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (when) ref.current?.focus({ preventScroll: false });
  }, [key, when, ref]);
}

export function HelpFlow({ userId, can = HELP_CAN_ALL, start, knownIssues, variant, onClose, children }: HelpFlowProps): ReactNode {
  const ids = useId();
  const H = variant === 'page' ? 'h2' : 'h3';
  const explicit = Boolean(start?.text?.trim() || start?.details?.trim());

  const [firstDraft] = useState(() => initialDraft(start));
  const [form, setForm] = useState<ReportDraft>(firstDraft);
  const [phase, setPhase] = useState<HelpPhase>(() => (start?.step === 'details' ? 'details' : 'describe'));
  const [typed, setTyped] = useState(false);
  const [restoreApplied, setRestoreApplied] = useState(false);

  /* ---- Draft -------------------------------------------------------------- */

  const ignoredRestore = useRef(false);
  const draft = useDraft<ReportDraft>({
    key: draftKey(userId),
    value: { ...form, step: phase === 'details' || phase === 'review' ? phase : 'describe' },
    isEmpty: isEmptyDraft,
    onRestore: (value) => {
      const restored = readReportDraft(value);
      // Opened with words of their own ("Report 'vpn' as an issue"): those
      // win, and the older draft stays stored until this one replaces it.
      if (!restored || explicit) {
        ignoredRestore.current = true;
        return;
      }
      setForm(restored);
      setPhase(restored.step);
      setRestoreApplied(true);
    },
  });
  const { notice, dismissNotice } = draft;
  useEffect(() => {
    if (notice === 'restored' && ignoredRestore.current) dismissNotice();
  }, [notice, dismissNotice]);

  const edit = useCallback((patch: Partial<ReportDraft>) => {
    setTyped(true);
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  /* ---- Step 1 ----------------------------------------------------------------- */

  const textRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const doneRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLHeadingElement | null>(null);
  const [describeError, setDescribeError] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<OpenAnswer | null>(null);
  const [dismissedIssues, setDismissedIssues] = useState(false);

  const found = useSuggestions(form.text, can, { enabled: phase === 'describe' });
  const published = useKnownIssues();
  const issues = knownIssues ?? published;
  const matching = useMemo(() => (dismissedIssues ? [] : matchingIssues(issues.issues, form.text)), [dismissedIssues, issues.issues, form.text]);

  // Heard once per settled search, never per keystroke.
  const lastAnnounced = useRef('');
  useEffect(() => {
    if (found.loading || !found.query || found.query === lastAnnounced.current) return;
    lastAnnounced.current = found.query;
    const count = found.answers.length + found.services.length + found.requests.length;
    announce(count === 0 ? 'No suggestions' : count === 1 ? '1 suggestion' : `${count} suggestions`);
  }, [found]);

  /**
   * The title and details step 2 was last given from step 1's words, so going
   * back and changing them updates step 2 — unless the person rewrote a field
   * there themselves. Details they were started with ("Related to …") are
   * theirs from the outset.
   */
  const derived = useRef<{ title: string; details: string }>({ title: firstDraft.title, details: start?.details?.trim() ? '' : firstDraft.details });

  const toDetails = (): void => {
    const text = form.text.trim();
    if (!text) {
      setDescribeError('Tell us what you need help with first.');
      textRef.current?.focus();
      return;
    }
    setDescribeError(undefined);
    const split = splitDescription(text);
    const before = derived.current;
    derived.current = split;
    setForm((current) => ({
      ...current,
      title: current.title === '' || current.title === before.title ? split.title : current.title,
      details: current.details === '' || current.details === before.details ? split.details : current.details,
    }));
    setAnswer(null);
    setPhase('details');
  };

  const openAnswer = (hit: SearchHit): void => {
    setAnswer({ hit, article: null, failed: false });
    const key = articleHref(hit).slice('/knowledge/'.length);
    api
      .article(decodeURIComponent(key))
      .then((article) => setAnswer((current) => (current?.hit.entityId === hit.entityId ? { ...current, article } : current)))
      .catch(() => setAnswer((current) => (current?.hit.entityId === hit.entityId ? { ...current, failed: true } : current)));
  };

  const closeAnswer = (): void => {
    const id = answer?.hit.entityId;
    setAnswer(null);
    // Back to the answer they opened, so the list keeps their place.
    requestAnimationFrame(() => {
      const button = id ? document.querySelector<HTMLElement>(`[data-answer="${id.replace(/["\\]/g, '\\$&')}"]`) : null;
      (button ?? textRef.current)?.focus();
    });
  };

  const solved = (): void => {
    const key = answer?.article?.key ?? answer?.hit.facets.key;
    // The only signal of a question answered without a ticket there is; worth
    // sending, never worth waiting for.
    if (typeof key === 'string' && key) void api.rateArticle(key, true).catch(() => undefined);
    notify('Glad that helped', { tone: 'success' });
    onClose();
  };

  useEffect(() => {
    if (answer && (answer.article || answer.failed)) articleRef.current?.focus();
  }, [answer]);

  /* ---- Step 2 and the review ------------------------------------------------------ */

  const [errors, setErrors] = useState<{ title?: string; details?: string }>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<SentOutcome | null>(null);
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const intent = useRef<{ key: string; body: string } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const titleId = `${ids}-title`;
  const detailsId = `${ids}-details`;
  const formId = `${ids}-form`;
  const reviewId = `${ids}-review`;
  const headingLevel = variant === 'page' ? 2 : 3;

  /** Field problems from the checks or the API: shown beside their fields, on the details step. */
  const showFieldProblems = (problems: { title?: string | undefined; details?: string | undefined }, message: string | null): void => {
    setErrors({ ...(problems.title ? { title: problems.title } : {}), ...(problems.details ? { details: problems.details } : {}) });
    setFormMessage(message);
    setAttempt((count) => count + 1);
    setPhase('details');
  };

  /** Details → review, once the title and details check out. */
  const toReview = (event?: FormEvent): void => {
    event?.preventDefault();
    const problems = validateReport(form);
    if (problems.title || problems.details) {
      showFieldProblems(problems, null);
      return;
    }
    setErrors({});
    setFormMessage(null);
    setPhase('review');
  };

  const finish = (outcome: 'sent' | 'queued', number: string | null = null, panel: ReactNode = null): void => {
    sending.current = false;
    intent.current = null;
    setForm(EMPTY_DRAFT);
    draft.clear();
    setBusy(false);
    setErrors({});
    setFormMessage(null);
    if (outcome === 'sent') {
      setSent({ number, panel });
      // The page behind (Home, My requests) shows the new request when the sheet closes.
      startRefresh(() => router.refresh());
    }
    setPhase(outcome);
  };

  /** Set synchronously, so a second press in the same moment cannot start a second send. */
  const sending = useRef(false);

  const send = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (sending.current) return;
    const problems = validateReport(form);
    if (problems.title || problems.details) {
      showFieldProblems(problems, null);
      return;
    }
    sending.current = true;
    setBusy(true);
    setErrors({});
    setFormMessage(null);

    const title = form.title.trim();
    const details = form.details.trim();
    const request = queueable.reportIssue({ title, ...(details ? { description: details } : {}), urgency: form.urgency });
    const body = JSON.stringify(request.body);
    // The same report as last time (a retry) keeps its key; an edited one is a new intent.
    const idempotencyKey = intent.current?.body === body ? intent.current.key : newIdempotencyKey();
    intent.current = { key: idempotencyKey, body };

    let result: Awaited<ReturnType<typeof submitOrQueue>>;
    try {
      result = await submitOrQueue({ action: 'report-issue', path: `/api/proxy${request.path}`, body: request.body, summary: title, idempotencyKey });
    } catch {
      // Neither sent nor kept: the device refused to store it (a full or blocked store).
      sending.current = false;
      if (!live.current) return;
      setFormMessage('That didn’t send, and this device couldn’t keep it for later. Your report is still here — try again.');
      setAttempt((count) => count + 1);
      setBusy(false);
      return;
    }
    if (!live.current) return;

    if (result.queued) {
      finish('queued');
      return;
    }
    if (result.ok) {
      // It is in: nothing typed is worth restoring from here on, whatever the panel does.
      draft.clear();
      const created = (await result.response?.json().catch(() => null)) as { number?: unknown } | null;
      const number = typeof created?.number === 'string' ? created.number : null;
      // "Sending" stays on the button while the server draws the ending: one change of screen, not two.
      const panel = number ? await drawSent(number, headingLevel) : null;
      if (!live.current) return;
      finish('sent', number, panel);
      return;
    }

    const problem = result.response ? await sendProblemOf(result.response) : { status: 0, fields: {} };
    if (!live.current) return;
    sending.current = false;
    setBusy(false);
    if (problem.status === 401) {
      // The frame asks them to sign in again; what they wrote waits on this device.
      draft.flush();
      reportSessionEnded('action');
      return;
    }
    const fieldTitle = problem.fields.title;
    const fieldDetails = problem.fields.description;
    if (fieldTitle || fieldDetails) {
      // The API named a field: back to it, with the message beside it.
      showFieldProblems({ title: fieldTitle, details: fieldDetails }, sendFailureMessage(problem));
      return;
    }
    setFormMessage(sendFailureMessage(problem));
    setAttempt((count) => count + 1);
  };

  /** Mod+Enter moves on from anywhere in a step's form; Enter in the title moves to the details. */
  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey) {
      // The details box moves on with its own shortcut; from anywhere else in the
      // form (the title, an urgency card that took the key first) it is ours.
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      event.currentTarget.requestSubmit();
      return;
    }
    // Enter in the title moves on to the details rather than skipping them.
    if (!event.defaultPrevented && event.target === titleRef.current) {
      event.preventDefault();
      document.getElementById(detailsId)?.focus();
    }
  };

  /* ---- Focus as the steps change ---------------------------------------------- */

  const reviewRef = useRef<HTMLHeadingElement | null>(null);
  useFocusOnChange(textRef, phase, phase === 'describe' && !answer);
  // Back on the details because of a problem: the summary takes focus (its own `focusKey`), not the title.
  useFocusOnChange(titleRef, phase, phase === 'details' && !errors.title && !errors.details);
  useFocusOnChange(reviewRef, phase, phase === 'review');
  useFocusOnChange(doneRef, phase, phase === 'sent' || phase === 'queued');

  /* ---- Drawing ----------------------------------------------------------------- */

  const initialFocusRef = (start?.step === 'details' ? titleRef : textRef) as RefObject<HTMLElement | null>;
  const showSaved = typed || restoreApplied ? draft.savedAt : null;

  const draftNotice = (
    <DraftNotice
      notice={ignoredRestore.current ? null : notice}
      onDiscard={() => {
        draft.discard();
        setForm(initialDraft(undefined));
        setPhase('describe');
        setRestoreApplied(false);
        textRef.current?.focus();
      }}
      onDismiss={dismissNotice}
    />
  );

  /** The step header (v3 §7.2): where they are of the three, done steps ticked. */
  const progress = (step: HelpStep): ReactNode => {
    const at = STEPS.findIndex((candidate) => candidate.id === step);
    return (
      <Stepper
        className="app-HelpFlow__steps"
        label="Steps"
        size="sm"
        steps={STEPS.map((candidate, index) => ({ id: candidate.id, label: candidate.label, status: index < at ? 'complete' : index === at ? 'current' : 'upcoming' }))}
      />
    );
  };

  let parts: HelpFlowParts;

  if (phase === 'sent') {
    const sentNumber = sent?.number ?? null;
    parts = {
      title: 'Report sent',
      initialFocusRef: doneRef,
      phase,
      body: sent?.panel ? (
        // The server's panel: a hero named by its heading, focused as a whole so it is read from the top.
        <div ref={doneRef} tabIndex={-1} className="app-HelpSent" data-outcome="sent">
          {sent.panel}
        </div>
      ) : (
        <div ref={doneRef} tabIndex={-1} className="app-HelpDone" data-outcome="sent">
          <span className="app-HelpDone__mark" aria-hidden="true">
            <Icon name="circle-check" size="2xl" />
          </span>
          <H className="app-HelpDone__title">
            We’ve got it{sentNumber ? <> · <strong className="app-HelpDone__number">{sentNumber}</strong></> : null}
          </H>
          <p className="app-HelpDone__next">
            <strong>What happens next:</strong> someone from the service desk will pick it up. You’ll get updates here and by email.
          </p>
        </div>
      ),
      footer: (
        <>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button variant="primary" href={sentNumber ? `/tickets/${encodeURIComponent(sentNumber)}` : '/tickets'}>
            Track it
          </Button>
        </>
      ),
    };
  } else if (phase === 'queued') {
    parts = {
      title: 'Saved on this device',
      initialFocusRef: doneRef,
      phase,
      body: (
        <div ref={doneRef} tabIndex={-1} className="app-HelpDone" data-outcome="queued">
          <span className="app-HelpDone__mark app-HelpDone__mark--queued" aria-hidden="true">
            <Icon name="cloud-off" size="2xl" />
          </span>
          <H className="app-HelpDone__title">Saved on this device</H>
          <p className="app-HelpDone__promise">We’ll send it when you’re back online.</p>
          <p className="app-HelpDone__next">It’s in your outbox until then. Nothing else to do — you’ll see it in My requests once it’s sent.</p>
        </div>
      ),
      footer: (
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              // The top bar's connection pill holds the outbox tray; it opens once the flow is out of the way.
              setTimeout(() => document.querySelector<HTMLButtonElement>('.itsm-ConnectionStatus__pill')?.click(), 250);
            }}
          >
            See what’s waiting
          </Button>
          <Button variant="primary" href="/" {...(variant === 'sheet' ? { onClick: onClose } : {})}>
            Back to Home
          </Button>
        </>
      ),
    };
  } else if (phase === 'review') {
    const choice = URGENCY_CHOICES.find((candidate) => candidate.value === form.urgency);
    parts = {
      title: 'Report an issue',
      stepLabel: stepLabelFor('review'),
      initialFocusRef: reviewRef as RefObject<HTMLElement | null>,
      phase,
      body: (
        <div className="app-HelpFlow app-HelpFlow--review">
          {progress('review')}
          <FormErrorSummary errors={[]} {...(formMessage ? { description: formMessage } : {})} title="It didn’t send" headingLevel={headingLevel} focusKey={attempt} />
          <form id={reviewId} className="app-HelpReview" noValidate onSubmit={(event) => void send(event)} onKeyDown={onFormKeyDown} aria-labelledby={`${reviewId}-heading`}>
            <div className="app-HelpReview__head">
              <H id={`${reviewId}-heading`} ref={reviewRef} tabIndex={-1} className="app-HelpReview__title">
                Check your report
              </H>
              <Button variant="ghost" size="sm" iconStart="pencil" onClick={() => setPhase('details')} disabled={busy}>
                Edit<VisuallyHidden> the report</VisuallyHidden>
              </Button>
            </div>
            {/*
              A plain definition list in this file's styles, not the design system's
              DescriptionList: shared with the request flow's renderer, that module
              would move into a chunk `/tickets/[id]` loads too (≈ 0.4 kB there).
            */}
            <dl className="app-HelpReview__answers">
              <div className="app-HelpReview__pair">
                <dt>Title</dt>
                <dd>{form.title.trim()}</dd>
              </div>
              <div className="app-HelpReview__pair">
                <dt>Details</dt>
                <dd className="app-HelpReview__text">{form.details.trim() || 'None given'}</dd>
              </div>
              <div className="app-HelpReview__pair">
                <dt>How much it’s holding you up</dt>
                <dd>{choice?.label}</dd>
              </div>
            </dl>
          </form>
        </div>
      ),
      footer: (
        <>
          <Button variant="secondary" onClick={() => setPhase('details')} disabled={busy}>
            Back
          </Button>
          <Button variant="primary" type="submit" form={reviewId} loading={busy} loadingLabel="Sending" iconEnd="send">
            Send report
          </Button>
        </>
      ),
    };
  } else if (phase === 'details') {
    const summary = [
      ...(errors.title ? [{ fieldId: titleId, message: errors.title }] : []),
      ...(errors.details ? [{ fieldId: detailsId, message: errors.details }] : []),
    ];
    parts = {
      title: 'Report an issue',
      stepLabel: stepLabelFor('details'),
      initialFocusRef,
      phase,
      body: (
        <div className="app-HelpFlow app-HelpFlow--details">
          {progress('details')}
          {draftNotice}
          <FormErrorSummary
            errors={summary}
            {...(formMessage ? { description: formMessage } : {})}
            title={summary.length > 0 ? 'Check the report' : 'It didn’t send'}
            headingLevel={headingLevel}
            focusKey={attempt}
          />
          <form id={formId} className="app-HelpFlow__form" noValidate onSubmit={toReview} onKeyDown={onFormKeyDown} aria-labelledby={`${ids}-details-heading`}>
            <H id={`${ids}-details-heading`} className="itsm-visually-hidden">
              The details
            </H>
            <FormField label="Title" required id={titleId} hint="A few words the desk will see first." {...(errors.title ? { error: errors.title } : {})}>
              <Input
                ref={titleRef}
                value={form.title}
                maxLength={TITLE_MAX}
                autoComplete="off"
                enterKeyHint="next"
                onChange={(event) => edit({ title: event.target.value })}
              />
            </FormField>
            <FormField
              label="Details"
              optional
              id={detailsId}
              hint="What you were doing, what you saw, anything you’ve already tried."
              {...(errors.details ? { error: errors.details } : {})}
            >
              <Textarea
                value={form.details}
                rows={4}
                autoGrow
                maxLength={DETAILS_MAX}
                submitShortcut="mod+enter"
                submitHint="to continue"
                onChange={(event) => edit({ details: event.target.value })}
              />
            </FormField>
            <RadioGroup<Urgency>
              label="How much is this holding you up?"
              variant="cards"
              className="app-HelpFlow__urgency"
              value={form.urgency}
              onChange={(value) => {
                if (isUrgency(value)) edit({ urgency: value });
              }}
              options={URGENCY_CHOICES.map((choice) => ({
                value: choice.value,
                label: choice.label,
                description: URGENCY_LOOK[choice.value].consequence,
                icon: <IconTile icon={URGENCY_LOOK[choice.value].icon} size={32} tone={URGENCY_LOOK[choice.value].tone} />,
              }))}
            />
          </form>
        </div>
      ),
      footer: (
        <>
          <DraftStatus savedAt={showSaved} className="app-HelpFlow__saved" />
          <Button variant="secondary" onClick={() => setPhase('describe')}>
            Back
          </Button>
          <Button variant="primary" type="submit" form={formId} iconEnd="arrow-right">
            Continue
          </Button>
        </>
      ),
    };
  } else if (answer) {
    const { hit, article, failed } = answer;
    parts = {
      title: 'How can we help?',
      stepLabel: stepLabelFor('describe'),
      initialFocusRef: textRef as RefObject<HTMLElement | null>,
      phase,
      body: (
        <article className="app-HelpFlow app-HelpAnswer" aria-labelledby={`${ids}-answer`}>
          <H id={`${ids}-answer`} ref={articleRef} tabIndex={-1} className="app-HelpAnswer__title">
            {article?.title ?? hit.title}
          </H>
          {article ? (
            <>
              {article.summary ? <p className="app-HelpAnswer__summary">{article.summary}</p> : null}
              <Prose>
                <RichText content={asRichBlocks(article.body)} />
              </Prose>
              <p className="app-HelpAnswer__full">
                <Button variant="ghost" size="sm" href={articleHref(hit)} iconEnd="arrow-right">
                  Open the full article
                </Button>
              </p>
            </>
          ) : failed ? (
            <p className="app-HelpFlow__quiet">
              We couldn’t open this article here.{' '}
              <Button variant="ghost" size="sm" href={articleHref(hit)}>
                Open it on its own page
              </Button>
            </p>
          ) : (
            <p className="app-HelpFlow__quiet" role="status">
              <Spinner size="sm" /> Opening the article…
            </p>
          )}
        </article>
      ),
      footer: (
        <>
          <Button variant="secondary" iconStart="arrow-left" onClick={closeAnswer}>
            Back to my report
          </Button>
          <Button variant="primary" iconStart="check" onClick={solved}>
            This solved it
          </Button>
        </>
      ),
    };
  } else {
    parts = {
      title: 'How can we help?',
      stepLabel: stepLabelFor('describe'),
      initialFocusRef,
      phase,
      body: (
        <div className="app-HelpFlow app-HelpFlow--describe">
          {progress('describe')}
          {draftNotice}
          <form
            className="app-HelpFlow__form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              toDetails();
            }}
          >
            <FormField
              label="What do you need help with?"
              hint="A sentence is plenty. We’ll look for answers as you type."
              {...(describeError ? { error: describeError } : {})}
            >
              <Input
                ref={textRef}
                size="lg"
                prefix="search"
                value={form.text}
                maxLength={DETAILS_MAX}
                autoComplete="off"
                enterKeyHint="next"
                placeholder="My laptop won’t connect to the VPN"
                onChange={(event) => {
                  if (describeError) setDescribeError(undefined);
                  edit({ text: event.target.value });
                }}
              />
            </FormField>
          </form>
          {matching.length > 0 ? <KnownIssueCallout issues={matching} followUrl={issues.followUrl} onDismiss={() => setDismissedIssues(true)} /> : null}
          <Suggested found={found} idPrefix={ids} headingAs={H} onOpenAnswer={openAnswer} />
        </div>
      ),
      footer: (
        <Button variant="primary" iconEnd="arrow-right" onClick={toDetails}>
          Continue — report this as an issue
        </Button>
      ),
    };
  }

  return children(parts);
}
