'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Card, Disclosure, Icon, notify, ProgressBar, VisuallyHidden } from '@itsm/ui';
import { AttentionCard, type AttentionCardProps } from './AttentionCard.js';
import { SETUP_DISMISS_KEY, setupIncomplete, type SetupStep } from './presentation.js';

/*
 * "Hide checklist", per person on this device (SPEC §6.1): `localStorage`,
 * under the design system's dismissal prefix, so signing out forgets it
 * with every other dismissed notice. Brought back by ⌘K "Setup checklist"
 * (`/?setup=1`), which clears the dismissal. Storage that is blocked keeps
 * the dismissal for the page.
 */
const STORAGE_KEY = `itsm-dismissed:${SETUP_DISMISS_KEY}`;
let hiddenHere = false;
const listeners = new Set<() => void>();

function readHidden(): boolean {
  if (hiddenHere) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  hiddenHere = hidden;
  try {
    if (hidden) window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked: `hiddenHere` keeps it for this page.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Whether this person hid the checklist here. The server cannot know, so the
 * server render and hydration assume not — a new desk's checklist is part of
 * the first paint instead of jumping in after it.
 */
export function useSetupHidden(): boolean {
  return useSyncExternalStore(subscribe, readHidden, () => false);
}

export interface BriefingLeadProps {
  /** The checklist's steps, or null when this person can read none of its sources. */
  readonly steps: readonly SetupStep[] | null;
  /** `?setup=1`: shown even when hidden or complete, and un-hidden. */
  readonly force: boolean;
  /** Needs attention, or null when this person may consult none of its sources. */
  readonly attention: AttentionCardProps | null;
}

/**
 * The top of the briefing's main column: the first-run checklist while a
 * new desk is being set up, and Needs attention.
 *
 * While the checklist shows it *replaces* an empty Needs attention (a new
 * desk has nothing to attend to, and "Nothing needs you" beside "four steps
 * to go" says two things at once) — but never hides a problem: if something
 * does need attention, its card stays under the checklist.
 */
export function BriefingLead({ steps, force, attention }: BriefingLeadProps): ReactNode {
  const hidden = useSetupHidden();

  useEffect(() => {
    if (force) writeHidden(false);
  }, [force]);

  const showChecklist = steps !== null && steps.length > 0 && (force || (!hidden && setupIncomplete(steps)));
  const attentionEmpty = attention !== null && attention.items.length === 0 && attention.failures.length === 0;
  // A problem outranks homework: when something needs attention it comes
  // first, and the checklist waits underneath. `?setup=1` asked for the list.
  const checklistFirst = force || attentionEmpty;
  const checklist = showChecklist ? <SetupChecklist steps={steps} expanded={force} /> : null;

  return (
    <>
      {checklistFirst ? checklist : null}
      {attention && !(showChecklist && attentionEmpty) ? <AttentionCard {...attention} /> : null}
      {checklistFirst ? null : checklist}
    </>
  );
}

function hide(): void {
  writeHidden(true);
  notify('Setup checklist hidden', {
    description: 'Find it again with ⌘K › Setup checklist.',
    undo: async () => writeHidden(false),
  });
}

/**
 * "Set up your desk": the steps still to do, each with the page to do it on;
 * the ones already done fold into a line beneath (all of them are listed
 * when the checklist was asked for from ⌘K).
 */
export function SetupChecklist({ steps, expanded = false }: { readonly steps: readonly SetupStep[]; readonly expanded?: boolean }): ReactNode {
  const known = steps.filter((step) => step.done !== null);
  const done = known.filter((step) => step.done === true).length;
  const complete = known.length > 0 && done === known.length;
  const listed = expanded || complete ? steps : steps.filter((step) => step.done !== true);
  const folded = expanded || complete ? [] : steps.filter((step) => step.done === true);

  return (
    <div className="app-Setup">
      <Card
        title={complete ? 'Your desk is set up' : 'Set up your desk'}
        subtitle={complete ? 'Everything the checklist looks for is in place.' : 'The few things every desk needs to run well.'}
        icon="circle-check"
        actions={
          <Button size="sm" variant="ghost" onClick={hide}>
            Hide<VisuallyHidden> setup checklist</VisuallyHidden>
          </Button>
        }
      >
        {known.length > 0 ? (
          <div className="app-Setup__progress">
            <ProgressBar value={done / known.length} label={`${done} of ${known.length} done`} tone={complete ? 'success' : 'accent'} />
          </div>
        ) : null}
        <ol className="app-Setup__steps">
          {listed.map((step) => {
            const state = step.done === true ? 'done' : step.done === false ? 'todo' : 'unknown';
            return (
              <li key={step.id} className="app-Setup__step" data-state={state} data-step={step.id}>
                <span className="app-Setup__mark">
                  {step.done ? (
                    <Icon name="check" size="xs" label="Done" />
                  ) : (
                    <VisuallyHidden>{step.done === false ? 'Not done yet' : 'Not known'}</VisuallyHidden>
                  )}
                </span>
                <div className="app-Setup__text">
                  <p className="app-Setup__title">{step.title}</p>
                  <p className="app-Setup__description">{step.description}</p>
                </div>
                {step.done !== true && step.href ? (
                  <div className="app-Setup__action">
                    <Button size="sm" variant="secondary" href={step.href}>
                      {step.action}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        {folded.length > 0 ? (
          <Disclosure summary={`${folded.length} already done`} className="app-Setup__done">
            <ul className="app-Setup__doneList">
              {folded.map((step) => (
                <li key={step.id} data-step={step.id}>
                  <Icon name="check" size="xs" className="app-Setup__doneMark" />
                  {step.title}
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </Card>
    </div>
  );
}
