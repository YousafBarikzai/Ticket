'use client';

import { isValidElement, type ReactNode } from 'react';
import type { ActionSpec, ButtonVariant, Size } from '../types.js';
import { ActionSpecButton } from '../web/ActionSpecButton.js';

/**
 * How the feedback components turn an `ActionSpec` — an action described as
 * data, so a server component can hand it over — into a control.
 *
 * The control itself is `ActionSpecButton`, the one renderer every group
 * shares (a page header's actions come through it too): a link-styled button
 * for `href`, a button that reports its `id` to `onAction` otherwise, a
 * confirmation first when the spec asks for one, and a state gate as
 * `disabledReason` — focusable, described, explained on press (SPEC §1.10).
 *
 * What a notice or an empty state adds is room: a gated action's reason is
 * also written out beside it, so it is on the page for everybody rather than
 * only on focus or press (X-80). The button already carries the reason as its
 * description, so the line is plain text, not a second description.
 *
 * A caller that already has a control passes a React node instead, and it is
 * rendered as it is.
 */

/** Whether a value is an `ActionSpec` rather than something to render as it is. */
export function isActionSpec(value: unknown): value is ActionSpec {
  if (typeof value !== 'object' || value === null || isValidElement(value) || Array.isArray(value)) return false;
  const candidate = value as Partial<ActionSpec>;
  return typeof candidate.id === 'string' && typeof candidate.label === 'string';
}

export interface FeedbackActionProps {
  readonly action: ActionSpec | ReactNode;
  /** Receives the `id` of an `ActionSpec` without `href` when it is chosen (after confirmation, if it asks). */
  readonly onAction?: (id: string) => void | Promise<void>;
  /** The emphasis when the spec names none: the first action of an empty state is primary, the rest secondary. */
  readonly defaultVariant: ButtonVariant;
  readonly size?: Size;
}

/** One action: an `ActionSpec` made into a link or a button, or a node passed through. */
export function FeedbackAction({ action, onAction, defaultVariant, size = 'md' }: FeedbackActionProps): ReactNode {
  if (!isActionSpec(action)) return action;
  const reason = action.disabled && action.disabledReason ? action.disabledReason : undefined;
  return (
    <>
      <ActionSpecButton spec={action} defaultVariant={defaultVariant} size={size} {...(onAction ? { onAction } : {})} />
      {reason ? <span className="itsm-FeedbackAction__reason">{reason}</span> : null}
    </>
  );
}

export interface FeedbackActionsProps {
  readonly primary?: ActionSpec | ReactNode;
  readonly secondary?: ActionSpec | ReactNode;
  readonly onAction?: (id: string) => void | Promise<void>;
  readonly size?: Size;
  /** Emphasis of the first action when its spec names none. */
  readonly primaryVariant?: ButtonVariant;
  readonly secondaryVariant?: ButtonVariant;
  readonly className: string;
}

/** The actions row of a notice or an empty state; nothing at all when there are no actions. */
export function FeedbackActions({
  primary,
  secondary,
  onAction,
  size = 'md',
  primaryVariant = 'primary',
  secondaryVariant = 'secondary',
  className,
}: FeedbackActionsProps): ReactNode {
  const hasPrimary = primary !== undefined && primary !== null && primary !== false;
  const hasSecondary = secondary !== undefined && secondary !== null && secondary !== false;
  if (!hasPrimary && !hasSecondary) return null;
  return (
    <div className={className}>
      {hasPrimary ? <FeedbackAction action={primary} onAction={onAction} defaultVariant={primaryVariant} size={size} /> : null}
      {hasSecondary ? <FeedbackAction action={secondary} onAction={onAction} defaultVariant={secondaryVariant} size={size} /> : null}
    </div>
  );
}
