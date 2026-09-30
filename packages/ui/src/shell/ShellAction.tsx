'use client';

import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ActionSpec, ButtonVariant, Size } from '../types.js';
import { Button } from '../web/Button.js';

const LazyConfirmDialog = lazy(() => import('../overlays/ConfirmDialog.js').then((module) => ({ default: module.ConfirmDialog })));

export interface ShellActionProps {
  readonly spec: ActionSpec;
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
 * An `ActionSpec` — an action described as data, so a server page can hand
 * it over — drawn as the frame draws actions: a link-styled `Button` when it
 * goes somewhere, a button that reports its `id` when it does something, a
 * confirmation first when it asks for one (loaded on demand), and a state
 * gate as `disabledReason` — focusable, explained on press (D19).
 *
 * With `bindShortcut`, the spec's shortcut presses it: `c` on a list page
 * creates, as the keyboard map says (D14). Single-key shortcuts follow the
 * person's switch and never fire while typing.
 */
export function ShellAction({ spec, defaultVariant, size = 'md', onAction, bindShortcut = false, className }: ShellActionProps): ReactNode {
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
