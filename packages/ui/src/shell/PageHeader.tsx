'use client';

import { isValidElement, lazy, Suspense, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import type { MenuItemSpec } from '../overlays/Menu.js';
import { MD_UP, useMediaQuery } from '../overlays/media.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ActionSpec, Crumb } from '../types.js';
import { ActionSpecButton } from '../web/ActionSpecButton.js';
import { cx } from '../web/cx.js';
import { Breadcrumbs } from './Breadcrumbs.js';
import { usePublishPage, useShellContext } from './context.js';
import { lazyModule, useIntentLoader } from './lazy.js';
import { LazyMenuButton } from './LazyMenuButton.js';
import { ShellLink } from './ShellLink.js';
import { TabNav, type TabNavItem } from './TabNav.js';

export interface PageHeaderProps {
  readonly title: string;
  readonly titleId?: string;
  /**
   * The page's purpose line: one line, no full stop. The sidebar frame's top
   * bar shows it under the title (it wins over the nav item's description);
   * elsewhere it is drawn under the heading.
   */
  readonly purpose?: string;
  /**
   * Context chips for the sidebar frame's top bar — context the page does not
   * show itself (never "As at", never the SLA figure, X-M4). Elsewhere they
   * sit beside the heading.
   */
  readonly context?: ReactNode;
  /**
   * `page` (default): a hub or list page — in the sidebar frame the top bar
   * shows this title and the `<h1>` steps back to a visually hidden focus
   * target. `section`: a record page — the bar shows "‹ {section}" back to
   * its list, and the record's `<h1>` stays visible here.
   */
  readonly barTitle?: 'page' | 'section';
  /** In-content only, on list and hub pages while they have no data. Not the purpose line. */
  readonly subtitle?: string;
  readonly breadcrumbs?: readonly Crumb[];
  readonly back?: { readonly href: string; readonly label: string };
  /** One of `status` or `meta` beside the title, never both (X-36). */
  readonly status?: ReactNode;
  readonly meta?: string;
  /** The page's one primary action. */
  readonly primaryAction?: ActionSpec | ReactNode;
  /** Collapse into the overflow menu below md. */
  readonly secondaryActions?: readonly ActionSpec[];
  readonly overflow?: readonly MenuItemSpec[];
  readonly tabs?: readonly TabNavItem[];
  readonly largeTitle?: boolean;
  readonly sticky?: boolean;
  /** Renders the *View only* pill-button that explains the missing permission (X-47). */
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key?: string };
  /**
   * Client only: receives the `id` of an action without `href` — primary or
   * secondary — once chosen (and confirmed, when it asks).
   */
  readonly onAction?: (id: string) => void | Promise<void>;
  readonly className?: string;
}

const LazyConfirmDialog = lazy(() => import('../overlays/ConfirmDialog.js').then((module) => ({ default: module.ConfirmDialog })));
const viewOnlyModule = lazyModule(() => import('./ViewOnlyPopover.js'));

function isSpec(value: unknown): value is ActionSpec {
  if (typeof value !== 'object' || value === null || isValidElement(value)) return false;
  const candidate = value as Partial<ActionSpec>;
  return typeof candidate.id === 'string' && typeof candidate.label === 'string';
}

function ViewOnlyPill({ label, permission, permissionKey }: { readonly label: string; readonly permission: string; readonly permissionKey?: string }): ReactNode {
  const loader = useIntentLoader(viewOnlyModule);
  const pill = (props: Record<string, unknown>): ReactElement<{ id?: string }> => (
    <button type="button" className="itsm-PageHeader__viewOnly" {...props}>
      <Icon name="eye" size="xs" />
      <span>View only</span>
    </button>
  );
  const Popover = loader.loaded?.ViewOnlyPopover;
  if (!Popover) return pill({ ...loader.intentProps, 'aria-haspopup': 'dialog', 'aria-expanded': false });
  return (
    <Popover
      trigger={pill({ ref: loader.triggerRef })}
      open={loader.open}
      onOpenChange={loader.setOpen}
      label={label}
      permission={permission}
      {...(permissionKey ? { permissionKey } : {})}
    />
  );
}

/** Whether a sticky header has come to rest against the top, for its shadow. */
function useStuck(enabled: boolean): [(node: HTMLElement | null) => void, boolean] {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!enabled || !sentinel || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => setStuck(entry ? !entry.isIntersecting : false));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, sentinel]);
  return [setSentinel, stuck];
}

/**
 * The top of every page, and its only `<h1>` — which takes focus after a
 * navigation (`tabindex="-1"`, the target of `RouteFocus`).
 *
 * It publishes the page's title, purpose, context chips and way back to the
 * frame (v3 §3.4, the title contract). In the sidebar frame the top bar shows
 * the title and purpose, so on a hub or list page the `<h1>` is
 * `.itsm-visually-hidden-focusable` — still in `main`, still the focus
 * target, shown as a band while it holds keyboard focus — and the visible row
 * holds only the companion, *View only*, the actions and the tabs: "the title
 * is in the top bar; content starts with a toolbar row". A record page
 * (`barTitle="section"`) keeps its `<h1>` visible; the bar says "‹ Rules".
 * The Help Portal keeps its visible `<h1>` everywhere.
 *
 * One line holds the title and at most one companion — a status pill or a
 * single meta item (X-36) — plus the *View only* pill when the person may
 * look but not change (X-47). The actions sit at the end: secondaries, then
 * the page's **one** primary action (a secondary that asks to be primary is
 * drawn as secondary), then ⋯ for the rest. Below 768 px the secondaries fold
 * into ⋯. `tabs` draws route tabs underneath; `breadcrumbs` or `back` above.
 *
 * `title1` by default; `largeTitle` for the few hub pages that open with a
 * greeting. `sticky` keeps it at the top of the scrolling page, under the
 * frame's bars, opaque, with a shadow once it is resting there. No eyebrow,
 * no overline.
 */
export function PageHeader({
  title,
  titleId,
  purpose,
  context,
  barTitle = 'page',
  subtitle,
  breadcrumbs,
  back,
  status,
  meta,
  primaryAction,
  secondaryActions,
  overflow,
  tabs,
  largeTitle = false,
  sticky = false,
  viewOnly,
  onAction,
  className,
}: PageHeaderProps): ReactNode {
  const generatedId = useStableId('itsm-page-title');
  const headingId = titleId ?? generatedId;
  const itsm = useOptionalItsm();
  const wide = useMediaQuery(MD_UP, true);
  const [confirming, setConfirming] = useState<ActionSpec | null>(null);
  const [sentinel, stuck] = useStuck(sticky);
  // The sidebar frame's top bar shows a hub page's title and purpose itself.
  const inBar = useShellContext()?.variant === 'sidebar' && barTitle === 'page';

  // The way back the bars show: the explicit one, or the nearest breadcrumb
  // that can be followed.
  const parent = back ?? [...(breadcrumbs ?? []).slice(0, -1)].reverse().find((crumb) => crumb.href);
  usePublishPage({
    title,
    ...(parent?.href ? { back: { href: parent.href, label: parent.label } } : {}),
    ...(purpose ? { purpose } : {}),
    ...(context !== undefined && context !== null ? { context } : {}),
    barTitle,
  });

  const secondaries = (secondaryActions ?? []).map((spec) => (spec.variant === 'primary' ? { ...spec, variant: 'secondary' as const } : spec));

  const run = (spec: ActionSpec): void => {
    if (spec.disabled) return;
    if (spec.confirm) {
      setConfirming(spec);
      return;
    }
    void perform(spec);
  };
  const perform = (spec: ActionSpec): void | Promise<void> => {
    if (!spec.href) return onAction?.(spec.id);
    if (spec.external) window.open(spec.href, '_blank', 'noopener,noreferrer');
    else if (itsm) itsm.router.push(spec.href);
    else window.location.assign(spec.href);
  };

  // Below md the secondaries join the overflow menu, ahead of what was already there.
  const folded: MenuItemSpec[] = wide
    ? []
    : secondaries.map((spec) => ({
        id: spec.id,
        label: spec.label,
        ...(spec.icon ? { icon: spec.icon } : {}),
        ...(spec.tone ? { tone: spec.tone } : {}),
        ...(spec.disabled ? { disabled: true, ...(spec.disabledReason ? { disabledReason: spec.disabledReason } : {}) } : {}),
        ...(spec.href && !spec.confirm && !spec.external ? { href: spec.href } : { onSelect: () => run(spec) }),
      }));
  const menuItems: MenuItemSpec[] = [...folded, ...(folded.length > 0 && overflow && overflow.length > 0 ? [{ type: 'separator' as const }] : []), ...(overflow ?? [])];
  const hasOverflowButton = menuItems.length > 0;

  const primary = primaryAction === undefined || primaryAction === null ? null : isSpec(primaryAction) ? (
    <ActionSpecButton spec={primaryAction} defaultVariant="primary" onAction={onAction} bindShortcut className="itsm-PageHeader__primary" />
  ) : (
    primaryAction
  );

  const companion = status ?? (meta ? <span className="itsm-PageHeader__meta">{meta}</span> : null);

  return (
    <>
      {sticky ? <div ref={sentinel} className="itsm-PageHeader__sentinel" aria-hidden="true" /> : null}
      <header
        className={cx('itsm-PageHeader', className)}
        data-sticky={sticky || undefined}
        data-stuck={(sticky && stuck) || undefined}
        data-large={largeTitle || undefined}
        data-has-tabs={tabs && tabs.length > 0 ? '' : undefined}
        data-title-in-bar={inBar || undefined}
      >
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} className="itsm-PageHeader__breadcrumbs" />
        ) : back ? (
          <ShellLink href={back.href} className="itsm-PageHeader__back">
            <Icon name="chevron-left" size="sm" directional />
            <span>{back.label}</span>
          </ShellLink>
        ) : null}

        <div className="itsm-PageHeader__row">
          <div className="itsm-PageHeader__heading">
            <h1 id={headingId} tabIndex={-1} className={cx('itsm-PageHeader__title', inBar && 'itsm-visually-hidden-focusable')}>
              {title}
            </h1>
            {companion ? <div className="itsm-PageHeader__companion">{companion}</div> : null}
            {!inBar && context ? <div className="itsm-PageHeader__context">{context}</div> : null}
            {viewOnly ? (
              <ViewOnlyPill label={viewOnly.label} permission={viewOnly.permission} {...(viewOnly.key ? { permissionKey: viewOnly.key } : {})} />
            ) : null}
          </div>

          {secondaries.length > 0 || primary || hasOverflowButton ? (
            <div className="itsm-PageHeader__actions">
              {secondaries.map((spec) => (
                <ActionSpecButton key={spec.id} spec={spec} defaultVariant="secondary" onAction={onAction} className="itsm-PageHeader__secondary" />
              ))}
              {primary}
              {hasOverflowButton ? (
                <span className="itsm-PageHeader__overflow">
                  <LazyMenuButton
                    items={menuItems}
                    align="end"
                    label={`More actions for ${title}`}
                    renderTrigger={(props) => (
                      <button type="button" className="itsm-PageHeader__more" aria-label="More actions" {...props}>
                        <Icon name="ellipsis" size="md" />
                      </button>
                    )}
                  />
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {purpose && !inBar ? <p className="itsm-PageHeader__purpose">{purpose}</p> : null}
        {subtitle ? <p className="itsm-PageHeader__subtitle">{subtitle}</p> : null}
        {tabs && tabs.length > 0 ? <TabNav label={title} items={tabs} className="itsm-PageHeader__tabs" /> : null}
      </header>
      {confirming?.confirm ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setConfirming(null);
            }}
            spec={confirming.confirm}
            onConfirm={async () => {
              await perform(confirming);
              setConfirming(null);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
