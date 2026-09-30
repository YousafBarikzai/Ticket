'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Toaster as Sonner, toast } from 'sonner';
import { announce } from '../a11y/announcer.js';
import { useHotkey } from '../a11y/hotkeys.js';
import { Spinner } from '../feedback/Spinner.js';
import { ProgressBar } from '../feedback/ProgressBar.js';
import { Icon } from '../icons/Icon.js';
import { defaultMessages, type UiMessages } from '../provider/messages.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { subscribeToNotifications, type NotifyEvent, type NotifyProgress, type NotifyTone } from '../provider/notify.js';
import type { IconName } from '../types.js';
import { Button } from '../web/Button.js';
import { IconButton } from '../web/IconButton.js';
import { problemText } from './problem-text.js';
import { TOAST_DURATION, ToastStore, ToastTimers, toastDuration, type ToastRecord } from './toast-store.js';

export interface ToasterProps {
  /** The region's name, "Status messages" by default (`messages.toastRegion`). */
  readonly label?: string;
}

const toneIcons: Readonly<Record<NotifyTone, IconName | null>> = {
  neutral: null,
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

/** What a screen reader hears when a toast appears: the words, and what can be done about it. */
function spoken(record: ToastRecord, messages: UiMessages): string {
  const parts = [record.message, record.description].filter(Boolean);
  if (record.undo) parts.push(`${messages.undo} available`);
  else if (record.action) parts.push(`${record.action.label} available`);
  return parts.join('. ');
}

function progressDone(progress: NotifyProgress): boolean {
  return progress.total > 0 && progress.done >= progress.total;
}

/** "Try again in 20 s", counting down, until `retryAt` has passed. */
function useSecondsUntil(at: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const left = at === undefined ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
  // The interval runs only while there is something to count, and is set up
  // once per countdown rather than once per tick.
  const counting = left > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  return left;
}

interface CardActions {
  readonly messages: UiMessages;
  readonly undo: (id: string) => void;
  readonly act: (id: string) => void;
  readonly cancel: (id: string) => void;
  readonly dismiss: (id: string) => void;
}

/**
 * One toast's content. It reads its record from the store, so an update
 * (a promise settling, progress moving, an undo finishing) redraws it in
 * place without sonner re-creating anything.
 */
function ToastCard({ id, store, actions }: { readonly id: string; readonly store: ToastStore; readonly actions: CardActions }): ReactNode {
  const record = useSyncExternalStore(store.subscribe, () => store.get(id), () => undefined);
  const wait = useSecondsUntil(record?.retryAt);
  if (!record) return null;
  const { messages } = actions;
  const icon = toneIcons[record.tone];
  const progress = record.progress;
  const done = progress ? progressDone(progress) : false;

  return (
    <div className="itsm-Toaster__toast" data-tone={record.tone}>
      {record.busy ? (
        <span className="itsm-Toaster__icon">
          <Spinner size="sm" />
        </span>
      ) : icon ? (
        <span className="itsm-Toaster__icon">
          <Icon name={icon} size="md" />
        </span>
      ) : null}
      <div className="itsm-Toaster__body">
        <p className="itsm-Toaster__title">{record.message}</p>
        {record.description ? <p className="itsm-Toaster__description">{record.description}</p> : null}
        {record.retryAt !== undefined && wait > 0 ? <p className="itsm-Toaster__description itsm-Toaster__wait">Try again in {wait} s</p> : null}
        {progress ? (
          <div className="itsm-Toaster__progress">
            <ProgressBar
              size="md"
              label={progress.label}
              labelHidden
              value={progress.total > 0 ? progress.done / progress.total : undefined}
              tone={done ? 'success' : 'accent'}
            />
            <span className="itsm-Toaster__count">
              {progress.done} of {progress.total}
            </span>
          </div>
        ) : null}
        {record.undo || record.action || (progress?.onCancel && !done) ? (
          <div className="itsm-Toaster__actions">
            {record.undo ? (
              <Button size="sm" variant="tinted" loading={record.undoing} onClick={() => actions.undo(id)}>
                {messages.undo}
              </Button>
            ) : null}
            {record.action ? (
              <Button
                size="sm"
                variant={record.undo ? 'ghost' : 'tinted'}
                disabledReason={record.retryAt !== undefined && wait > 0 ? `Try again in ${wait} s` : undefined}
                onClick={() => actions.act(id)}
              >
                {record.action.label}
              </Button>
            ) : null}
            {progress?.onCancel && !done ? (
              <Button size="sm" variant="ghost" onClick={() => actions.cancel(id)}>
                {messages.cancel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <IconButton className="itsm-Toaster__close" label={messages.dismiss} icon="x" size="sm" variant="ghost" onClick={() => actions.dismiss(id)} />
    </div>
  );
}

function initialDirection(): 'ltr' | 'rtl' {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}

/**
 * Where `notify()` toasts appear. Mounted once, lazily, by `ItsmProvider`;
 * it subscribes to the `notify` queue and replays what was waiting.
 *
 * Drawn by sonner (`unstyled`: stacking, the collapsed pile, swipe to
 * dismiss, Alt+T to reach the region) with the design system's own card:
 * opaque `surface.overlay`, radius `xl`, elevation `lg`, a tone icon, at most
 * three visible, bottom-end from 768 px and above the bottom dock below.
 *
 * The rules are this component's, not sonner's:
 *
 * - **Timing** (`ToastTimers`): 5 s, 8 s for warnings and for *Undo*;
 *   persistent for errors and for anything asking an action or a retry.
 *   Every countdown pauses while the pointer is over the toasts, while focus
 *   is in them and while the page is hidden.
 * - **Undo**: the button runs the caller's inverse with the toast held; it
 *   ends as "Undone" or as a persistent error. `mod+Z` runs the newest live
 *   undo (never inside a text field, where it belongs to the field).
 * - **Retry after a 429** (`retryAt`): the action stays unavailable, with
 *   its reason, while "Try again in 20 s" counts down.
 * - **Speech**: sonner's own live region is silenced and each toast is
 *   announced once through the design system's announcer — politely, or
 *   assertively for an error — so a progress toast is not read out at every
 *   step.
 */
export function Toaster({ label }: ToasterProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const name = label ?? messages.toastRegion;
  const sectionRef = useRef<HTMLElement | null>(null);
  const [dir] = useState(initialDirection);

  const store = useMemo(() => new ToastStore(), []);
  const timers = useMemo(() => new ToastTimers((id) => toast.dismiss(id)), []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const actions = useMemo<CardActions>(() => {
    const dismiss = (id: string): void => {
      timers.clear(id);
      toast.dismiss(id);
    };
    return {
      get messages() {
        return messagesRef.current;
      },
      dismiss,
      act(id) {
        const record = store.get(id);
        if (!record?.action) return;
        if (record.retryAt !== undefined && record.retryAt > Date.now()) return;
        record.action.onClick();
        dismiss(id);
      },
      cancel(id) {
        store.get(id)?.progress?.onCancel?.();
        dismiss(id);
      },
      undo(id) {
        const record = store.get(id);
        if (!record?.undo || record.undoing) return;
        const run = record.undo;
        timers.clear(id);
        store.patch(id, { undoing: true });
        run().then(
          () => {
            if (!store.has(id)) return;
            store.patch(id, { message: 'Undone', description: undefined, tone: 'success', undo: undefined, action: undefined, undoing: false, duration: TOAST_DURATION.brief });
            timers.set(id, TOAST_DURATION.brief);
            announce('Undone');
          },
          (error: unknown) => {
            if (!store.has(id)) return;
            store.patch(id, { message: 'Couldn’t undo that', description: problemText(error), tone: 'danger', undo: undefined, undoing: false, duration: 'persistent' });
            timers.set(id, 'persistent');
            announce(`Couldn’t undo that. ${problemText(error)}`, { politeness: 'assertive' });
          },
        );
      },
    };
  }, [store, timers]);

  // The queue: every event becomes a record, a sonner toast and a countdown.
  useEffect(() => {
    const mount = (id: string): void => {
      toast.custom(() => <ToastCard id={id} store={store} actions={actions} />, {
        id,
        // Sonner never times a toast out: `ToastTimers` does (see above).
        duration: Number.POSITIVE_INFINITY,
        unstyled: true,
        onDismiss: () => {
          timers.clear(id);
          store.delete(id);
        },
      });
    };
    const speak = (record: ToastRecord): void => {
      announce(spoken(record, messagesRef.current), { politeness: record.tone === 'danger' ? 'assertive' : 'polite' });
    };

    const handle = (event: NotifyEvent): void => {
      switch (event.type) {
        case 'show': {
          const { options } = event;
          const record: ToastRecord = {
            id: event.id,
            message: event.message,
            description: options.description,
            tone: options.tone ?? 'neutral',
            action: options.action,
            undo: options.undo,
            retryAt: options.retryAt,
            duration: toastDuration(options),
          };
          const fresh = !store.has(event.id);
          store.set(record);
          if (fresh) mount(event.id);
          timers.set(event.id, record.duration);
          speak(record);
          break;
        }
        case 'promise': {
          const { id, messages: copy } = event;
          store.set({ id, message: copy.loading, tone: 'neutral', busy: true, duration: 'persistent' });
          mount(id);
          event.promise.then(
            (value) => {
              if (!store.has(id)) return;
              const record = store.patch(id, {
                message: typeof copy.success === 'function' ? copy.success(value) : copy.success,
                tone: 'success',
                busy: false,
                duration: TOAST_DURATION.default,
              });
              timers.set(id, TOAST_DURATION.default);
              if (record) speak(record);
            },
            (error: unknown) => {
              if (!store.has(id)) return;
              const record = store.patch(id, {
                message: typeof copy.error === 'function' ? copy.error(error) : copy.error,
                tone: 'danger',
                busy: false,
                duration: 'persistent',
              });
              timers.set(id, 'persistent');
              if (record) speak(record);
            },
          );
          break;
        }
        case 'progress': {
          const { id, progress } = event;
          const previous = store.get(id);
          const done = progressDone(progress);
          const wasDone = previous?.progress ? progressDone(previous.progress) : false;
          store.set({
            id,
            message: progress.label,
            tone: done ? 'success' : 'neutral',
            progress,
            duration: done ? TOAST_DURATION.default : 'persistent',
          });
          if (!previous) mount(id);
          if (done && !wasDone) {
            timers.set(id, TOAST_DURATION.default);
            announce(`${progress.label}. ${progress.done} of ${progress.total} done`);
          } else if (!previous) {
            announce(progress.label);
          }
          break;
        }
        case 'dismiss': {
          if (event.id === undefined) {
            timers.clearAll();
            toast.dismiss();
          } else {
            timers.clear(event.id);
            toast.dismiss(event.id);
          }
          break;
        }
      }
    };

    const unsubscribe = subscribeToNotifications(handle);
    return () => {
      unsubscribe();
      timers.clearAll();
      toast.dismiss();
      store.clear();
    };
  }, [actions, store, timers]);

  // Reading or working in the toasts holds every countdown.
  useEffect(() => {
    const section = sectionRef.current;
    const onEnter = (): void => timers.hold('hover');
    const onLeave = (): void => timers.release('hover');
    const onFocusIn = (): void => timers.hold('focus');
    const onFocusOut = (event: FocusEvent): void => {
      if (!section?.contains(event.relatedTarget as Node | null)) timers.release('focus');
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') timers.hold('hidden');
      else timers.release('hidden');
    };
    section?.addEventListener('pointerenter', onEnter);
    section?.addEventListener('pointerleave', onLeave);
    section?.addEventListener('focusin', onFocusIn);
    section?.addEventListener('focusout', onFocusOut);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      section?.removeEventListener('pointerenter', onEnter);
      section?.removeEventListener('pointerleave', onLeave);
      section?.removeEventListener('focusin', onFocusIn);
      section?.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [timers]);

  // Sonner's region is a polite live region that would read every change
  // (each progress step); announcements go through the announcer instead.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    section.setAttribute('aria-live', 'off');
    section.removeAttribute('aria-relevant');
    section.removeAttribute('aria-atomic');
  }, []);

  const undoable = useSyncExternalStore(store.subscribe, store.latestUndo, () => null);
  useHotkey({
    keys: 'mod+z',
    description: 'Undo the last action',
    group: 'General',
    enabled: undoable !== null,
    handler: () => {
      if (undoable) actions.undo(undoable);
    },
  });

  const style = {
    '--width': 'min(22.5rem, calc(100vw - 2 * var(--itsm-space-lg)))',
  } as CSSProperties;
  const bottom = 'calc(max(var(--itsm-bottom-dock-height), var(--itsm-safe-area-bottom)) + var(--itsm-space-lg))';
  const mobileBottom = 'calc(max(var(--itsm-bottom-dock-height), var(--itsm-safe-area-bottom)) + var(--itsm-space-sm))';

  return (
    <Sonner
      ref={sectionRef}
      className="itsm-Toaster"
      customAriaLabel={name}
      containerAriaLabel={name}
      position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
      dir={dir}
      visibleToasts={3}
      gap={12}
      style={style}
      offset={{ top: 'var(--itsm-space-lg)', bottom, left: 'var(--itsm-space-lg)', right: 'var(--itsm-space-lg)' }}
      mobileOffset={{ top: 'var(--itsm-space-sm)', bottom: mobileBottom, left: 'var(--itsm-space-sm)', right: 'var(--itsm-space-sm)' }}
      toastOptions={{ unstyled: true, className: 'itsm-Toaster__item' }}
    />
  );
}
