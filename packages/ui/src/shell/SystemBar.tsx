import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner } from '../feedback/Spinner.js';
import { cx } from '../web/cx.js';

/**
 * What the bar is saying about the environment: `warning` puts the status in
 * an amber pill (the last ten minutes before a reset), `busy` swaps the status
 * for a spinner and {@link SYSTEM_BAR_BUSY_LABEL} (a reset is running).
 */
export type SystemBarState = 'default' | 'warning' | 'busy';

export interface SystemBarBadgeSpec {
  /** The word in the pill: "Demo". */
  readonly label: string;
  /** The session is live now: the dot pulses every 2 s, unless motion is reduced. */
  readonly live?: boolean;
}

export interface SystemBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role' | 'aria-label' | 'title'> {
  /** The landmark's name: "Demo environment". */
  readonly label: string;
  readonly badge?: SystemBarBadgeSpec;
  /** The countdown island ("Resets in 09:01:38"). A `<time>` inside it is set tabular and bright. */
  readonly status?: ReactNode;
  /** "Demo data resets every day at 00:00 UK time." The second line on a phone. */
  readonly message?: ReactNode;
  /** Wide screens only (≥ 80rem): "Changes are shared with other visitors…". */
  readonly note?: ReactNode;
  /** "You're **Alex Morgan** · Service Desk team lead". */
  readonly persona?: ReactNode;
  /** The buttons at the end. Give each the class `itsm-SystemBar__action` and its words `itsm-SystemBar__actionLabel`. */
  readonly actions?: ReactNode;
  readonly state?: SystemBarState;
  /** `center` for a bar with little in it: the public variant before sign-in. */
  readonly align?: 'start' | 'center';
  /** What `state="busy"` says beside its spinner. */
  readonly busyLabel?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/** The words of the busy state (SPEC-v3 §2.15). */
export const SYSTEM_BAR_BUSY_LABEL = 'Demo data is being reset';

/**
 * The navy strip above the whole frame, for a fact about the environment the
 * person is in rather than about the page: today, the shared demo (`DemoBar`
 * composes it, R11). Server-safe and 0 kB of JavaScript: the countdown and
 * the controls are islands the caller passes in.
 *
 * **The offset.** A sticky top bar has to sit under this one, so the frame
 * reads `--itsm-system-bar-h`. That variable is `0px` in the tokens and is
 * set in exactly one place, `SystemBar.styles.ts`, with
 * `:root:has(.itsm-SystemBar)` at ≥ 48rem (X-B1). Nothing has to remember to
 * set an attribute or a prop: a bar on the page is the bar's height, no bar is
 * zero. On a phone the bar is two lines in the normal flow and scrolls away,
 * so the offset stays zero there and the top bar never lands on top of it.
 *
 * **The state is the attribute.** Every state is drawn from `data-state` on
 * the root, and the busy line is in the markup from the start (hidden until
 * that attribute says `busy`). A client island that learns of a reset from a
 * poll can therefore flip the attribute on `closest('.itsm-SystemBar')`
 * without re-rendering a server component. It announces nothing itself:
 * nothing with `role="status"` may come before `main` (§3.9), and the demo
 * bar's own live region speaks for it.
 *
 * Inside, `data-surface="hero"` re-themes text and the focus ring for navy
 * (the base layer's rule), so the controls passed in need no colours of
 * their own beyond the action look this stylesheet gives them.
 */
export function SystemBar({
  label,
  badge,
  status,
  message,
  note,
  persona,
  actions,
  state = 'default',
  align = 'start',
  busyLabel = SYSTEM_BAR_BUSY_LABEL,
  className,
  ref,
  ...rest
}: SystemBarProps): ReactNode {
  const hasMessage = present(message);
  const hasPersona = present(persona);
  return (
    <div
      {...rest}
      ref={ref}
      role="region"
      aria-label={label}
      className={cx('itsm-SystemBar', className)}
      data-surface="hero"
      data-state={state}
      {...(align === 'center' ? { 'data-align': 'center' } : {})}
    >
      <div className="itsm-SystemBar__lead">
        {badge ? <SystemBarBadge label={badge.label} live={badge.live} /> : null}
        {present(status) ? <span className="itsm-SystemBar__status">{status}</span> : null}
        <span className="itsm-SystemBar__busy">
          <Spinner size="sm" />
          <span>{busyLabel}</span>
        </span>
      </div>
      {hasMessage || hasPersona ? (
        <div className="itsm-SystemBar__text">
          {hasMessage ? <span className="itsm-SystemBar__message">{message}</span> : null}
          {hasMessage && hasPersona ? (
            <span className="itsm-SystemBar__separator" aria-hidden="true">
              ·
            </span>
          ) : null}
          {hasPersona ? <span className="itsm-SystemBar__persona">{persona}</span> : null}
        </div>
      ) : null}
      {present(note) ? <div className="itsm-SystemBar__note">{note}</div> : null}
      {present(actions) ? <div className="itsm-SystemBar__actions">{actions}</div> : null}
    </div>
  );
}

export interface SystemBarBadgeProps {
  readonly label: string;
  readonly live?: boolean;
}

/**
 * The "● Demo" pill on its own, for a surface drawn in the bar's look that is
 * not the bar: the `hop` status screen's persona strip. Not a `SystemBar`, so
 * it never sets the frame offset.
 */
export function SystemBarBadge({ label, live = false }: SystemBarBadgeProps): ReactNode {
  return (
    <span className="itsm-SystemBar__badge" {...(live ? { 'data-live': '' } : {})}>
      <span className="itsm-SystemBar__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}
