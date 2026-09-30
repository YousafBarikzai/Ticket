'use client';

import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { Icon } from '../icons/Icon.js';
import type { ActionSpec, ButtonVariant, Size } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { Menu, type MenuItemSpec } from './Menu.js';

export interface SplitButtonProps {
  readonly primary: ActionSpec;
  /** Behind the chevron, labelled "More options for {label}". */
  readonly items: readonly MenuItemSpec[];
  readonly variant?: ButtonVariant;
  readonly size?: Size;
  /** Client only. */
  readonly onPrimary?: () => void;
  /** The main segment may be its form's only submit button; the chevron is always `type=button`. */
  readonly type?: 'button' | 'submit';
  /** The main action is under way: a spinner in the main segment (label and width kept), both segments inert. */
  readonly loading?: boolean;
  /** What the spinner means, for screen readers ("Sending…"). */
  readonly loadingLabel?: string;
  /** Controls the menu, for a caller that opens it from a shortcut (the composer's `mod+shift+Enter`). */
  readonly menuOpen?: boolean;
  /** The alternatives are unavailable too (nothing to send yet): the chevron is disabled with the main segment. */
  readonly menuDisabled?: boolean;
  readonly onMenuOpenChange?: (open: boolean) => void;
  readonly className?: string;
}

/**
 * One main action with its variants beside it: "Send · Send and resolve".
 *
 * Two buttons joined into one shape, with a hairline between them: the main
 * segment is the action (a link when `primary.href`, the form's submit
 * button when `type="submit"`), and the chevron — always `type="button"`,
 * named "More options for Send" — opens a `Menu` of the alternatives,
 * aligned to the button's end. `primary.disabledReason` keeps the main
 * segment focusable and explaining itself while the menu stays usable, and
 * `primary.confirm` asks before acting (a submit is completed after the
 * answer with the same button as submitter). `loading` shows the main
 * action under way, as a `Button` does; `menuOpen` lets a shortcut open the
 * menu.
 */
export function SplitButton({
  primary,
  items,
  variant = 'primary',
  size = 'md',
  onPrimary,
  type = 'button',
  loading = false,
  loadingLabel,
  menuOpen,
  menuDisabled = false,
  onMenuOpenChange,
  className,
}: SplitButtonProps): ReactNode {
  const mainRef = useRef<HTMLButtonElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const unavailable = primary.disabled === true;
  const reason = unavailable ? primary.disabledReason : undefined;
  const moreLabel = `More options for ${primary.label}`;

  const act = (): void => {
    onPrimary?.();
    if (type === 'submit') {
      const button = mainRef.current;
      button?.form?.requestSubmit(button);
    }
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!primary.confirm) {
      onPrimary?.();
      return;
    }
    // Ask first; a submit button's own submit waits for the answer.
    event.preventDefault();
    setConfirming(true);
  };

  return (
    <span className={cx('itsm-SplitButton', `itsm-SplitButton--${size}`, className)} data-variant={variant}>
      <Button
        ref={mainRef}
        className="itsm-SplitButton__main"
        variant={variant}
        size={size}
        type={type}
        href={primary.href}
        external={primary.external}
        iconStart={primary.icon}
        disabled={unavailable && reason === undefined}
        disabledReason={reason}
        loading={loading}
        loadingLabel={loadingLabel}
        aria-keyshortcuts={primary.shortcut ? ariaKeyShortcuts(primary.shortcut) : undefined}
        onClick={onClick}
      >
        {primary.label}
      </Button>
      <Menu
        align="end"
        items={items}
        {...(menuOpen === undefined ? {} : { open: menuOpen && !loading && !menuDisabled })}
        onOpenChange={onMenuOpenChange}
        trigger={
          <Button className="itsm-SplitButton__more" variant={variant} size={size} type="button" aria-label={moreLabel} disabled={loading || menuDisabled}>
            <Icon name="chevron-down" size={size === 'lg' ? 'md' : 'sm'} />
          </Button>
        }
      />
      {primary.confirm ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          spec={primary.confirm}
          onConfirm={async () => {
            act();
          }}
        />
      ) : null}
    </span>
  );
}
