'use client';

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { useIds } from '../a11y/ids.js';
import type { ConfirmDialogProps } from '../overlays/ConfirmDialog.js';
import type { ConfirmSpec } from '../types.js';
import { cx } from './cx.js';
import { useMergedRefs } from './refs.js';

/**
 * What a switch asks before it changes. One spec asks both ways; `{ on, off }`
 * asks only in the direction given — a kill switch usually asks before it
 * turns something off ("Turn off AI for everyone?") and not before it turns
 * it back on.
 */
export type SwitchConfirm = ConfirmSpec | { readonly on?: ConfirmSpec; readonly off?: ConfirmSpec };

export interface SwitchProps {
  readonly label: ReactNode;
  readonly checked: boolean;
  /** Called with the new state once it has happened: at once, or after `confirm` and `onRequestChange` agree. */
  readonly onChange: (checked: boolean) => void;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly labelHidden?: boolean;
  readonly size?: 'sm' | 'md';
  /**
   * Ask first (X-43). While the question is open the switch keeps its state
   * — `aria-checked` and the thumb do not move until it is confirmed, so
   * nothing animates on and then snaps back — and focus returns to the switch
   * when the dialog closes, however it closes.
   */
  readonly confirm?: SwitchConfirm;
  /**
   * Makes the change happen (a save), resolving `true` when it did. The
   * switch shows it is busy and keeps its state until then; `false` or a
   * rejection leaves it as it was. With `confirm`, it runs from the dialog's
   * confirm button, which shows the wait and keeps the dialog open with the
   * error if it rejects.
   */
  readonly onRequestChange?: (next: boolean) => Promise<boolean>;
  /**
   * `inline` (default): the switch before its label. `row`: label first and
   * the switch at the far end of the row, as settings lists lay out.
   */
  readonly layout?: 'inline' | 'row';
  readonly id?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly className?: string;
}

/** One fetch of the dialog's module, shared by the preload and the lazy component. */
let confirmDialogModule: Promise<typeof import('../overlays/ConfirmDialog.js')> | null = null;
function loadConfirmDialog(): Promise<typeof import('../overlays/ConfirmDialog.js')> {
  confirmDialogModule ??= import('../overlays/ConfirmDialog.js').catch((error: unknown) => {
    // A failed fetch (offline) is tried again next time rather than cached.
    confirmDialogModule = null;
    throw error;
  });
  return confirmDialogModule;
}

/**
 * If the dialog's code cannot be fetched (offline, a deploy replaced the
 * chunk), the question is still asked — with the browser's own confirm —
 * rather than the page failing or the change happening unasked.
 */
function FallbackConfirm({ open, spec, onOpenChange, onConfirm }: ConfirmDialogProps): ReactNode {
  // Once per opening, even where development mode runs effects twice.
  const asked = useRef(false);
  useEffect(() => {
    if (!open) {
      asked.current = false;
      return;
    }
    if (asked.current) return;
    asked.current = true;
    const accepted = window.confirm(spec.body ? `${spec.title}\n\n${spec.body}` : spec.title);
    if (!accepted) {
      onOpenChange(false);
      return;
    }
    onConfirm().then(
      () => onOpenChange(false),
      () => onOpenChange(false),
    );
  }, [open]);
  return null;
}

const LazyConfirmDialog = lazy(() =>
  loadConfirmDialog().then(
    (module) => ({ default: module.ConfirmDialog }),
    () => ({ default: FallbackConfirm }),
  ),
);

/** Starts fetching the dialog when a click looks likely, so asking does not wait for the network. */
function preloadConfirmDialog(): void {
  loadConfirmDialog().catch(() => undefined);
}

function specFor(confirm: SwitchConfirm | undefined, next: boolean): ConfirmSpec | undefined {
  if (!confirm) return undefined;
  if ('title' in confirm) return confirm;
  return next ? confirm.on : confirm.off;
}

/**
 * A `role="switch"` button.
 *
 * A switch takes effect immediately; a checkbox is submitted with a form. That
 * difference is why this is not `Checkbox` with different styling — the person
 * is told "on/off", not "ticked", and there is no Save button to look for.
 * When the change cannot be immediate — it saves, or it needs confirming —
 * the switch waits visibly rather than pretending (`onRequestChange`,
 * `confirm`).
 *
 * 44 × 26 (`md`) or 36 × 22 (`sm`). The thumb travels on the spring curve,
 * widens a little while pressed, and in the high-contrast themes the track
 * shows on/off glyphs as well as its colour.
 */
export function Switch({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  labelHidden = false,
  size = 'md',
  confirm,
  onRequestChange,
  layout = 'inline',
  id,
  ref,
  className,
}: SwitchProps): ReactNode {
  const ids = useIds('itsm-switch', ['control', 'label', 'description'] as const);
  const controlId = id ?? ids.control;
  const own = useRef<HTMLButtonElement | null>(null);
  const mergedRef = useMergedRefs<HTMLButtonElement>(ref, own);
  const [pending, setPending] = useState(false);
  /** The state being asked about, or null when no question is open. */
  const [asking, setAsking] = useState<boolean | null>(null);
  /** The last question asked, kept while the dialog animates out. */
  const [question, setQuestion] = useState<ConfirmSpec | null>(null);
  const mounted = useRef(true);
  const wasAsking = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Focus back on the switch once the dialog has gone, whichever way it went.
  useEffect(() => {
    if (asking !== null) {
      wasAsking.current = true;
      return;
    }
    if (!wasAsking.current) return;
    wasAsking.current = false;
    const frame = requestAnimationFrame(() => own.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [asking]);

  const request = async (next: boolean): Promise<void> => {
    if (disabled || pending || asking !== null) return;
    const spec = specFor(confirm, next);
    if (spec) {
      // Focused before the dialog opens, so the dialog hands focus back here
      // when it closes — Safari does not focus a button on click.
      own.current?.focus();
      setQuestion(spec);
      setAsking(next);
      return;
    }
    if (!onRequestChange) {
      onChange(next);
      return;
    }
    setPending(true);
    try {
      if (await onRequestChange(next)) onChange(next);
    } catch {
      // The caller reports its own failure; the switch simply stays as it was.
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const confirmChange = async (): Promise<void> => {
    const next = asking;
    if (next === null) return;
    // A rejection propagates: the dialog stays open and shows the error.
    const accepted = onRequestChange ? await onRequestChange(next) : true;
    if (accepted) onChange(next);
    if (mounted.current) setAsking(null);
  };

  const inert = disabled || pending;

  return (
    <div
      className={cx('itsm-Choice', 'itsm-SwitchField', layout === 'row' && 'itsm-SwitchField--row', className)}
      data-disabled={disabled ? '' : undefined}
    >
      <button
        ref={mergedRef}
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={ids.label}
        aria-describedby={description ? ids.description : undefined}
        aria-disabled={inert || undefined}
        aria-busy={pending || undefined}
        className={cx('itsm-Switch', `itsm-Switch--${size}`, 'itsm-Choice__control')}
        onPointerEnter={confirm ? preloadConfirmDialog : undefined}
        onFocus={confirm ? preloadConfirmDialog : undefined}
        onClick={() => void request(!checked)}
      >
        <span className="itsm-Switch__glyph itsm-Switch__glyph--on" aria-hidden="true" />
        <span className="itsm-Switch__glyph itsm-Switch__glyph--off" aria-hidden="true" />
        <span className="itsm-Switch__thumb" aria-hidden="true" />
      </button>
      <span className="itsm-Choice__text">
        {/* A label for the button: clicking the words flips the switch, as clicking a checkbox's label ticks it. */}
        <label className={cx('itsm-Choice__label', labelHidden && 'itsm-visually-hidden')} id={ids.label} htmlFor={controlId}>
          {label}
        </label>
        {description ? (
          <span className="itsm-Choice__description" id={ids.description}>
            {description}
          </span>
        ) : null}
      </span>
      {question ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            open={asking !== null}
            spec={question}
            onOpenChange={(open) => {
              if (!open) setAsking(null);
            }}
            onConfirm={confirmChange}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
