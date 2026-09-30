'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { submitOrQueue } from '@itsm/pwa';
import {
  Button,
  DraftNotice,
  FormField,
  Icon,
  InlineAlert,
  Stepper,
  Textarea,
  announce,
  describeProblem,
  notify,
  useDraft,
  type Problem,
  type StepperStep,
  type Tone,
} from '@itsm/ui';
import { api } from '../client/api.js';
import { reportSessionEnded, toastProblem } from '../client/useAction.js';
import { useHelpFlow } from '../components/PortalShell.js';
import { openComposer, useIntentKey, useOnline } from './hooks.js';
import { relatedDetails, taskProgressLabel, type HeroModel } from './model.js';
import { moveRequest, problemOfFailure, reopenWithMessage, type RequesterMove } from './resolution.js';
import { useConfirmFixed } from './useConfirmFixed.js';

/**
 * The one card at the top of a request (SPEC §6.3, X-35): the state said
 * once, whose move it is, the one thing to do about it, the four-dot
 * progress and the sentence about time.
 *
 * - **Waiting for you** — *Reply* opens the composer below.
 * - **Is it fixed?** — *Yes, it's fixed* closes it (PA1); *No, still broken*
 *   opens "What's still happening?" in the card, and *Reopen request*
 *   reopens it first and then sends their words (`reopenWithMessage`), so a
 *   retry never reopens twice or posts twice. Past the reopen window it
 *   offers *Report it again* with their words carried over.
 * - **Closed / Withdrawn** — *Report it again* opens "How can we help?" at
 *   the details, prefilled with the title and "Related to INC-000123".
 * - **More** — *Withdraw request*, *It's sorted now*: quieter moves, each
 *   confirmed in the card.
 *
 * Every move is online only, and says "Needs a connection" rather than
 * failing; messages queue. After a move the page redraws from the server
 * and focus lands on this card's heading, which now says the new state.
 * A change made by somebody else is announced, politely, once.
 */

export interface RequestHeroProps {
  readonly number: string;
  readonly title: string;
  readonly status: string;
  readonly version: number;
  readonly hero: HeroModel;
  readonly steps: readonly StepperStep[];
  readonly sla: string | null;
  readonly tasks: { readonly done: number; readonly total: number } | null;
  readonly approval: string | null;
  /** May move the request (`ticket.transition`). */
  readonly canMove: boolean;
  /** May write on it (`ticket.comment.public`): Reply. */
  readonly canReply: boolean;
  /** Opened from a "No" elsewhere (`?fixed=no`): start with "What's still happening?" open. */
  readonly startWithNo?: boolean;
  /** Whose device drafts these are; none without one. */
  readonly readerId: string | null;
}

type Panel = 'none' | 'no' | 'withdraw' | 'sorted';

interface Notice {
  readonly tone: Tone;
  readonly text: string;
}

const CHANGED = 'This request changed while you were writing. Your words are still here — try again.';

/** A failure as one sentence under the form, keeping what they wrote. */
function sentenceFor(problem: Problem): string {
  if (problem.status === 409 || problem.status === 428) return CHANGED;
  if (problem.status === 401) return 'Your session ended. Your words are still here — sign in again, then try again.';
  const described = describeProblem(problem);
  return `${described.title}. Your words are still here — try again.`;
}

export function RequestHero({
  number,
  title,
  status,
  version,
  hero,
  steps,
  sla,
  tasks,
  approval,
  canMove,
  canReply,
  startWithNo = false,
  readerId,
}: RequestHeroProps): ReactNode {
  const router = useRouter();
  const helpFlow = useHelpFlow();
  const online = useOnline();
  const baseId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const noRef = useRef<HTMLButtonElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);

  const confirming = hero.primary === 'confirm' && canMove;
  const [panel, setPanel] = useState<Panel>(startWithNo && confirming ? 'no' : 'none');
  const [moreOpen, setMoreOpen] = useState(false);
  const [text, setText] = useState('');
  const [sortedText, setSortedText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tooLate, setTooLate] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [busy, setBusy] = useState<RequesterMove | null>(null);
  const busyRef = useRef(false);
  const [refreshing, startRefresh] = useTransition();
  const focusAfter = useRef(false);
  const ownChange = useRef(false);
  const { keyFor, settle } = useIntentKey();
  const fixed = useConfirmFixed(number, version, {
    onSettled: () => {
      ownChange.current = true;
      focusAfter.current = true;
    },
  });
  /** Whether the next panel to open takes focus: on a press, or on arriving to say "No" — not on a restored draft. */
  const focusPanel = useRef(startWithNo && confirming);

  // "What's still happening?" survives a lost session: kept on this device while it is being written.
  const draft = useDraft<string>({
    key: confirming && readerId ? `itsm-draft:reopen:${readerId}:${number}` : null,
    value: text,
    isEmpty: (value) => value.trim() === '',
    onRestore: (value) => {
      setText(value);
      setPanel('no');
    },
  });

  // After their own move has redrawn the page, the heading says what it is now.
  useEffect(() => {
    if (refreshing || fixed.pending || !focusAfter.current) return;
    focusAfter.current = false;
    headingRef.current?.focus();
  }, [refreshing, fixed.pending, status]);

  // Somebody else's move is news: said once, politely. Their own is thanked by a toast.
  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current === status) return;
    previousStatus.current = status;
    if (ownChange.current) {
      ownChange.current = false;
      return;
    }
    announce(`This request is now: ${hero.title}`);
  }, [status, hero.title]);

  /**
   * Redraws the page from the server. A page opened to say "No"
   * (`?fixed=no`) is redrawn at its plain address instead, so a reload later
   * does not open the question again.
   */
  const redraw = (): void => {
    ownChange.current = true;
    focusAfter.current = true;
    const { pathname, search } = window.location;
    startRefresh(() => (new URLSearchParams(search).has('fixed') ? router.replace(pathname, { scroll: false }) : router.refresh()));
  };

  const offline = online ? {} : { disabledReason: 'Needs a connection' };

  const openPanel = (next: Panel): void => {
    focusPanel.current = true;
    setMoreOpen(false);
    setNotice(null);
    setFieldError(null);
    setPanel(next);
  };

  const closePanel = (returnTo: 'no' | 'more'): void => {
    setPanel('none');
    setNotice(null);
    setFieldError(null);
    setTooLate(false);
    // After the panel has gone, back to what opened it — or, when that has gone too, to the card's heading.
    requestAnimationFrame(() => ((returnTo === 'no' ? noRef.current : moreRef.current) ?? headingRef.current)?.focus());
  };

  // Where a panel puts focus when it opens: the words, or "Keep it" before a withdrawal (X-69).
  useEffect(() => {
    if (!focusPanel.current || panel === 'none') return;
    focusPanel.current = false;
    if (panel === 'withdraw') keepRef.current?.focus();
    else fieldRef.current?.focus();
  }, [panel]);

  const escape = (event: KeyboardEvent<HTMLElement>, returnTo: 'no' | 'more'): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || busy) return;
    event.preventDefault();
    closePanel(returnTo);
  };

  const reportAgain = (words = ''): void => {
    helpFlow.open({ step: 'details', text: title, details: relatedDetails(number, words) });
  };

  /* ---- The quieter moves: withdraw, "It's sorted now" ------------------- */

  const move = async (to: 'cancelled' | 'resolved', reason?: string): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(to);
    setNotice(null);
    try {
      const outcome = await moveRequest(api, number, version, to, reason);
      if (outcome.kind === 'refused') {
        setNotice({ tone: 'warning', text: 'You can’t make this change here. Send us a message and we’ll do it for you.' });
        return;
      }
      notify(
        outcome.kind === 'moved' ? 'This request has moved on since the page loaded' : to === 'cancelled' ? 'Request withdrawn' : 'Thanks — we’ve marked it as sorted',
        { tone: outcome.kind === 'moved' ? 'info' : 'success' },
      );
      setPanel('none');
      setSortedText('');
      redraw();
    } catch (error) {
      const problem = problemOfFailure(error);
      if (problem.status === 401) reportSessionEnded('action');
      if (problem.status === 401 || problem.status === 409 || problem.status === 428) setNotice({ tone: 'danger', text: sentenceFor(problem) });
      else toastProblem(problem, () => void move(to, reason));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  /* ---- No, still broken ---------------------------------------------------- */

  const reopen = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (busyRef.current) return;
    const words = text.trim();
    if (!words) {
      setFieldError('Tell us what’s still happening, so we know where to start.');
      fieldRef.current?.focus();
      return;
    }
    setFieldError(null);
    busyRef.current = true;
    setBusy('reopened');
    setNotice(null);
    try {
      const outcome = await reopenWithMessage(
        { transition: api.transition, ticket: api.ticket, send: submitOrQueue },
        { number, version, text: words, key: keyFor(words), reopened },
      );
      switch (outcome.kind) {
        case 'done':
          notify('Reopened. We’ll pick it back up.', {
            tone: 'success',
            ...(outcome.queued ? { description: 'Your message will send when you’re back online.' } : {}),
          });
          settle();
          draft.clear();
          setText('');
          setReopened(false);
          setPanel('none');
          redraw();
          return;
        case 'moved':
          notify('This request has moved on since the page loaded', { tone: 'info' });
          setPanel('none');
          redraw();
          return;
        case 'too-late':
          setTooLate(true);
          setNotice({ tone: 'warning', text: 'It’s been too long to reopen this. Report it again and we’ll link the two.' });
          return;
        case 'refused':
          setTooLate(true);
          setNotice({ tone: 'warning', text: 'This request can’t be reopened from here. Report it again and we’ll link the two.' });
          return;
        case 'message-failed':
          setReopened(true);
          ownChange.current = true;
          if (outcome.problem.status === 401) reportSessionEnded('action');
          setNotice({ tone: 'danger', text: 'Reopened. Your message didn’t send. Your words are still here — try again.' });
          return;
        case 'failed':
          if (outcome.problem.status === 401) {
            draft.flush();
            reportSessionEnded('action');
          }
          setNotice({ tone: 'danger', text: sentenceFor(outcome.problem) });
          return;
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  /* ---- Drawing ------------------------------------------------------------- */

  const headingId = `${baseId}-state`;
  const moreId = `${baseId}-more`;
  const panelId = `${baseId}-panel`;
  const moves = canMove ? hero.more : [];

  const primaryRow = (): ReactNode => {
    if (panel !== 'none') return null;
    const items: ReactNode[] = [];
    if (hero.primary === 'reply' && canReply) {
      items.push(
        <Button key="reply" variant="primary" iconStart="reply" onClick={openComposer}>
          Reply
        </Button>,
      );
    }
    if (hero.primary === 'confirm' && canMove) {
      if (fixed.acknowledged) {
        items.push(
          <p key="thanks" className="app-RequestHero__status" role="status">
            <Icon name="circle-check" size="sm" />
            Thanks for confirming. It will close automatically.
          </p>,
        );
      } else {
        items.push(
          <Button
            key="yes"
            variant="primary"
            iconStart="check"
            loading={fixed.pending}
            loadingLabel="Closing"
            {...offline}
            onClick={() => void fixed.confirm()}
          >
            Yes, it’s fixed
          </Button>,
          <Button key="no" ref={noRef} variant="secondary" onClick={() => openPanel('no')}>
            No, still broken
          </Button>,
        );
      }
    }
    if (hero.primary === 'report-again' && helpFlow.available) {
      items.push(
        <Button key="again" variant="primary" iconStart="plus" onClick={() => reportAgain()}>
          Report it again
        </Button>,
      );
    }
    if (moves.length > 0) {
      items.push(
        <Button
          key="more"
          ref={moreRef}
          variant="ghost"
          iconEnd={moreOpen ? 'chevron-up' : 'chevron-down'}
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          More
        </Button>,
      );
    }
    if (items.length === 0) return null;
    return (
      <>
        <div className="app-RequestHero__actions">{items}</div>
        {moves.length > 0 ? (
          <ul id={moreId} className="app-RequestHero__more" aria-label="More for this request" hidden={!moreOpen}>
            {moves.includes('withdraw') ? (
              <li>
                <Button variant="ghost" size="sm" iconStart="ban" onClick={() => openPanel('withdraw')}>
                  Withdraw request
                </Button>
              </li>
            ) : null}
            {moves.includes('sorted') ? (
              <li>
                <Button variant="ghost" size="sm" iconStart="circle-check" onClick={() => openPanel('sorted')}>
                  It’s sorted now
                </Button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </>
    );
  };

  const noticeLine = notice ? (
    <InlineAlert tone={notice.tone} className="app-RequestHero__notice">
      {notice.text}
    </InlineAlert>
  ) : null;

  const panelBody = (): ReactNode => {
    switch (panel) {
      case 'no':
        return (
          <form id={panelId} className="app-RequestHero__panel" noValidate onSubmit={reopen} onKeyDown={(event) => escape(event, 'no')}>
            <DraftNotice
              notice={draft.notice}
              onDiscard={() => {
                draft.discard();
                setText('');
              }}
              onDismiss={draft.dismissNotice}
            />
            <FormField label="What’s still happening?" hint="We’ll reopen it and pick it back up from here." error={fieldError ?? undefined} required>
              {(control) => (
                <Textarea
                  {...control}
                  ref={fieldRef}
                  autoGrow
                  rows={3}
                  value={text}
                  submitShortcut="mod+enter"
                  submitHint={reopened ? 'to send' : 'to reopen'}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                />
              )}
            </FormField>
            {noticeLine}
            <div className="app-RequestHero__actions">
              {tooLate ? (
                helpFlow.available ? (
                  <Button variant="primary" iconStart="plus" onClick={() => reportAgain(text)}>
                    Report it again
                  </Button>
                ) : null
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy === 'reopened'}
                  loadingLabel={reopened ? 'Sending' : 'Reopening'}
                  {...(reopened ? {} : offline)}
                >
                  {reopened ? 'Try again' : 'Reopen request'}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  closePanel('no');
                  // It was reopened all the same: show the card as it is now.
                  if (reopened) redraw();
                }}
              >
                {reopened ? 'Not now' : 'Cancel'}
              </Button>
            </div>
          </form>
        );
      case 'withdraw':
        return (
          <div
            id={panelId}
            className="app-RequestHero__panel"
            role="group"
            aria-labelledby={`${panelId}-title`}
            onKeyDown={(event) => escape(event, 'more')}
          >
            <p id={`${panelId}-title`} className="app-RequestHero__panelTitle">
              Withdraw this request?
            </p>
            <p className="app-RequestHero__panelText">We’ll stop working on it. If you need it later, report it again.</p>
            {noticeLine}
            <div className="app-RequestHero__actions">
              <Button variant="danger" loading={busy === 'cancelled'} loadingLabel="Withdrawing" {...offline} onClick={() => void move('cancelled')}>
                Withdraw request
              </Button>
              <Button ref={keepRef} variant="secondary" disabled={busy !== null} onClick={() => closePanel('more')}>
                Keep it
              </Button>
            </div>
          </div>
        );
      case 'sorted':
        return (
          <form
            id={panelId}
            className="app-RequestHero__panel"
            noValidate
            aria-labelledby={`${panelId}-title`}
            onSubmit={(event) => {
              event.preventDefault();
              void move('resolved', sortedText);
            }}
            onKeyDown={(event) => escape(event, 'more')}
          >
            <p id={`${panelId}-title`} className="app-RequestHero__panelTitle">
              Glad it’s sorted
            </p>
            <FormField label="What fixed it?" optional hint="It helps us help the next person.">
              {(control) => (
                <Textarea
                  {...control}
                  ref={fieldRef}
                  autoGrow
                  rows={2}
                  value={sortedText}
                  submitShortcut="mod+enter"
                  submitHint="to save"
                  onChange={(event) => setSortedText(event.target.value)}
                />
              )}
            </FormField>
            {noticeLine}
            <div className="app-RequestHero__actions">
              <Button type="submit" variant="primary" loading={busy === 'resolved'} loadingLabel="Saving" {...offline}>
                Mark as sorted
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => closePanel('more')}>
                Cancel
              </Button>
            </div>
          </form>
        );
      default:
        return null;
    }
  };

  return (
    <section className="app-RequestHero" data-tone={hero.tone} aria-labelledby={headingId}>
      <div className="app-RequestHero__head">
        <span className="app-RequestHero__icon" aria-hidden="true">
          <Icon name={hero.icon} size="lg" />
        </span>
        <div className="app-RequestHero__text">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="app-RequestHero__title">
            {hero.title}
          </h2>
          <p className="app-RequestHero__sentence">{hero.sentence}</p>
          {approval ? <p className="app-RequestHero__fact">{approval}</p> : null}
        </div>
      </div>

      {primaryRow()}
      {panelBody()}

      <Stepper label="Progress" steps={steps} size="sm" className="app-RequestHero__steps" />

      {sla || tasks ? (
        <ul className="app-RequestHero__facts">
          {sla ? (
            <li>
              <Icon name="clock" size="sm" />
              {sla}
            </li>
          ) : null}
          {tasks ? (
            <li>
              <Icon name="circle-check" size="sm" />
              {taskProgressLabel(tasks)}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
