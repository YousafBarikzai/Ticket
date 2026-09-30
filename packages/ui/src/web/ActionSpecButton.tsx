'use client';

import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ActionSpec, ButtonVariant, Size } from '../types.js';
import { Button } from './Button.js';

// The overlays subpath, fetched only when an action that asks first is chosen:
// this file is reached from the root entry, which stays free of Radix (SPEC §3.1).
const LazyConfirmDialog = lazy(() => import('../overlays/ConfirmDialog.js').then((module) => ({ default: module.ConfirmDialog })));

export interface ActionSpecButtonProps {
  readonly spec: ActionSpec;
  /** The emphasis when the spec names none: a page's one primary, a notice's secondary. */
  readonly defaultVariant: ButtonVariant;
  readonly size?: Size;
  /** Receives the spec's `id` when an action without `href` is chosen (after its confirmation, if it asks). */
  readonly onAction?: (id: string) => void | Promise<void>;
  /** Binds `spec.shortcut` (the page's `c` for create). */
  readonly bindShortcut?: boolean;
  readonly className?: string;
}

/** Binds a page action's shortcut while it is drawn and available. */
function ShortcutBinding({ keys, description, onPress }: { readonly keys: string; readonly description: string; readonly onPress: () => void }): ReactNode {
  useHotkey({ keys, handler: onPress, description, group: 'This page' });
  return null;
}

/**
 * An `ActionSpec` — an action described as data, so a server component can
 * hand it over — drawn as a `Button`. The one place that happens: a page
 * header's actions, an empty state's, a banner's and a problem's all come
 * through here, so the same spec behaves the same wherever it is shown.
 *
 * - With `href`: a link styled as a button, through the application's `Link`;
 *   `external` opens a new tab and says so.
 * - Without: a button that reports its `id` through `onAction` — the client
 *   parent decides what "Retry" or "Publish" does.
 * - `confirm`: asks first, with `ConfirmDialog` loaded on demand. The dialog
 *   stays open, busy, while `onAction` runs, and shows its error if it
 *   rejects (SPEC §4.3), so a failed delete is never a silent close.
 * - `disabled` with `disabledReason`: a state gate (D19) — the button stays
 *   focusable, the reason is its description, and pressing it shows and says
 *   the reason (X-80). `disabled` alone is the native attribute.
 * - `bindShortcut`: the spec's `shortcut` presses it (D14), following the
 *   person's single-key switch and never while they type.
 */
export function ActionSpecButton({ spec, defaultVariant, size = 'md', onAction, bindShortcut = false, className }: ActionSpecButtonProps): ReactNode {
  const itsm = useOptionalItsm();
  const control = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const variant: ButtonVariant = spec.variant ?? (spec.tone === 'danger' ? 'danger' : defaultVariant);
  const unavailable = spec.disabled === true;

  const go = (): void | Promise<void> => {
    if (!spec.href) return onAction?.(spec.id);
    if (spec.external) {
      window.open(spec.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (itsm) itsm.router.push(spec.href);
    else window.location.assign(spec.href);
  };

  const asksFirst = spec.confirm !== undefined;
  // A link while it can simply be followed; one that asks first is a button
  // until the answer is yes. `Button` itself turns a gated link into a button.
  const linkLike = spec.href !== undefined && !asksFirst;

  return (
    <>
      <Button
        ref={(node: HTMLElement | null) => {
          control.current = node;
        }}
        variant={variant}
        size={size}
        className={className}
        data-action={spec.id}
        {...(spec.icon ? { iconStart: spec.icon } : {})}
        {...(linkLike ? { href: spec.href, ...(spec.external ? { external: true } : {}) } : {})}
        {...(unavailable && spec.disabledReason ? { disabledReason: spec.disabledReason } : {})}
        {...(unavailable && !spec.disabledReason ? { disabled: true } : {})}
        {...(spec.shortcut ? { 'aria-keyshortcuts': ariaKeyShortcuts(spec.shortcut) } : {})}
        {...(linkLike
          ? {}
          : {
              onClick: () => {
                if (unavailable) return;
                if (asksFirst) setConfirming(true);
                else void go();
              },
            })}
      >
        {spec.label}
      </Button>
      {bindShortcut && spec.shortcut && !unavailable ? (
        <ShortcutBinding keys={spec.shortcut} description={spec.label} onPress={() => control.current?.click()} />
      ) : null}
      {asksFirst && confirming ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            spec={spec.confirm!}
            onConfirm={async () => {
              await go();
              setConfirming(false);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
