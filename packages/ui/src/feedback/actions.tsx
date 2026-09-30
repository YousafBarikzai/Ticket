'use client';

import { isValidElement, lazy, Suspense, useState, type ComponentProps, type ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ActionSpec, ButtonVariant, Size } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';

/**
 * How the feedback components turn an `ActionSpec` — an action described as
 * data, so a server component can hand it over — into a control.
 *
 * - With `href`: a link in the button's classes, through the application's
 *   `Link` (client-side navigation and prefetch) or, outside a provider, a
 *   plain `<a>`. `external` opens a new tab and says so, with the one icon
 *   the product keeps for leaving it (SPEC §1.8).
 * - Without `href`: a button that reports its `id` to the component's
 *   `onAction` — the client parent decides what "Reload" or "Retry" does.
 * - `confirm`: asks first, with `ConfirmDialog` loaded from the overlays
 *   subpath on demand (the root entry stays free of Radix, SPEC §3.1 rule 1).
 * - `disabled` with `disabledReason`: the reason is visible text beside the
 *   control, and its description — never a tooltip (X-80).
 *
 * Only the `Button` props every version of it has are used here (variant,
 * size, `disabled`, `iconStart`, `onClick`), so this renders the same before
 * and after the actions package's richer `Button` lands.
 *
 * A caller that already has a control passes a React node instead, and it is
 * rendered as it is.
 */

const LazyConfirmDialog = lazy(() => import('../overlays/ConfirmDialog.js').then((module) => ({ default: module.ConfirmDialog })));

/** Whether a value is an `ActionSpec` rather than something to render as it is. */
export function isActionSpec(value: unknown): value is ActionSpec {
  if (typeof value !== 'object' || value === null || isValidElement(value) || Array.isArray(value)) return false;
  const candidate = value as Partial<ActionSpec>;
  return typeof candidate.id === 'string' && typeof candidate.label === 'string';
}

export interface FeedbackActionProps {
  readonly action: ActionSpec | ReactNode;
  /** Receives the `id` of an `ActionSpec` without `href` when it is chosen (after confirmation, if it asks). */
  readonly onAction?: (id: string) => void;
  /** The emphasis when the spec names none: the first action of an empty state is primary, the rest secondary. */
  readonly defaultVariant: ButtonVariant;
  readonly size?: Size;
}

/** One action: an `ActionSpec` made into a link or a button, or a node passed through. */
export function FeedbackAction({ action, onAction, defaultVariant, size = 'md' }: FeedbackActionProps): ReactNode {
  if (!isActionSpec(action)) return action;
  return <ActionSpecControl spec={action} onAction={onAction} defaultVariant={defaultVariant} size={size} />;
}

/**
 * The `variant` prop as whichever `Button` is installed spells it. The shared
 * six-way `ButtonVariant` (SPEC §4.0) selects a class of the same name, so the
 * cast changes nothing at run time; it only keeps this file compiling while
 * `Button`'s own union catches up with the shared one.
 */
type InstalledVariant = ComponentProps<typeof Button>['variant'];

function ActionSpecControl({
  spec,
  onAction,
  defaultVariant,
  size,
}: {
  readonly spec: ActionSpec;
  readonly onAction: ((id: string) => void) | undefined;
  readonly defaultVariant: ButtonVariant;
  readonly size: Size;
}): ReactNode {
  const itsm = useOptionalItsm();
  const reasonId = useStableId('itsm-action-reason');
  const [confirming, setConfirming] = useState(false);
  const variant: ButtonVariant = spec.variant ?? (spec.tone === 'danger' ? 'danger' : defaultVariant);
  const iconSize = size === 'sm' ? 'xs' : size === 'lg' ? 'md' : 'sm';

  const go = (): void => {
    if (!spec.href) {
      onAction?.(spec.id);
    } else if (spec.external) {
      window.open(spec.href, '_blank', 'noopener,noreferrer');
    } else if (itsm) {
      itsm.router.push(spec.href);
    } else {
      window.location.assign(spec.href);
    }
  };

  // A link while it can be followed; one that asks first, or is unavailable,
  // is a button until it can.
  if (spec.href && !spec.confirm && !spec.disabled) {
    const classes = cx('itsm-Button', `itsm-Button--${variant}`, `itsm-Button--${size}`);
    const content = (
      <>
        {spec.icon ? <Icon name={spec.icon} size={iconSize} className="itsm-Button__icon" /> : null}
        <span className="itsm-Button__label">{spec.label}</span>
      </>
    );
    if (spec.external) {
      return (
        <a href={spec.href} target="_blank" rel="noopener noreferrer" className={classes} data-action={spec.id}>
          {content}
          <Icon name="external" size={iconSize} className="itsm-Button__icon" directional />
          <span className="itsm-visually-hidden"> (opens in a new tab)</span>
        </a>
      );
    }
    const Link = itsm?.Link;
    return Link ? (
      <Link href={spec.href} className={classes} data-action={spec.id}>
        {content}
      </Link>
    ) : (
      <a href={spec.href} className={classes} data-action={spec.id}>
        {content}
      </a>
    );
  }

  const reason = spec.disabled && spec.disabledReason ? spec.disabledReason : undefined;
  return (
    <>
      <Button
        variant={variant as InstalledVariant}
        size={size}
        disabled={spec.disabled}
        aria-describedby={reason ? reasonId : undefined}
        data-action={spec.id}
        {...(spec.icon ? { iconStart: <Icon name={spec.icon} size={iconSize} /> } : {})}
        onClick={() => {
          if (spec.confirm) setConfirming(true);
          else go();
        }}
      >
        {spec.label}
      </Button>
      {reason ? (
        <span id={reasonId} className="itsm-FeedbackAction__reason">
          {reason}
        </span>
      ) : null}
      {confirming && spec.confirm ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            open
            spec={spec.confirm}
            onOpenChange={(open) => {
              if (!open) setConfirming(false);
            }}
            onConfirm={async () => {
              setConfirming(false);
              go();
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export interface FeedbackActionsProps {
  readonly primary?: ActionSpec | ReactNode;
  readonly secondary?: ActionSpec | ReactNode;
  readonly onAction?: (id: string) => void;
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
