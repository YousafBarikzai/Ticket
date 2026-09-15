import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { announce } from '../a11y/announcer.js';
import { IconButton } from './IconButton.js';

export type ToastIntent = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly intent?: ToastIntent;
  /**
   * Milliseconds, or `null` to stay until dismissed. A toast carrying an action
   * defaults to persistent: SC 2.2.1 says a time limit on something the user
   * must act on has to be avoidable.
   */
  readonly duration?: number | null;
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

interface ActiveToast extends ToastOptions {
  readonly id: string;
}

export interface ToastApi {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 6000;

export interface ToastProviderProps {
  readonly children: ReactNode;
  /** Names the region in the landmark list. */
  readonly label?: string;
}

export function ToastProvider({ children, label = 'Notifications' }: ToastProviderProps): ReactNode {
  const [toasts, setToasts] = useState<readonly ActiveToast[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions): string => {
      counter.current += 1;
      const id = `itsm-toast-${counter.current}`;
      setToasts((current) => [...current, { ...options, id }]);

      // The toast region is off to one side of the screen and away from focus,
      // so the text is also sent to the live-region announcer. Errors interrupt;
      // confirmations wait their turn.
      announce(options.description ? `${options.title}. ${options.description}` : options.title, {
        politeness: options.intent === 'danger' ? 'assertive' : 'polite',
      });

      const duration = options.duration === undefined ? (options.action ? null : DEFAULT_DURATION) : options.duration;
      if (duration !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            <div className="itsm-Toast__region" role="region" aria-label={label}>
              {toasts.map((item) => (
                <div
                  key={item.id}
                  className={cx('itsm-Toast', `itsm-Toast--${item.intent ?? 'info'}`)}
                  role={item.intent === 'danger' ? 'alert' : 'status'}
                  // Hovering or focusing a toast stops the clock: reading takes
                  // longer for some people than the default six seconds.
                  onMouseEnter={() => {
                    const timer = timers.current.get(item.id);
                    if (timer) clearTimeout(timer);
                  }}
                  onFocusCapture={() => {
                    const timer = timers.current.get(item.id);
                    if (timer) clearTimeout(timer);
                  }}
                >
                  <div className="itsm-Toast__body">
                    <div className="itsm-Toast__title">{item.title}</div>
                    {item.description ? <div className="itsm-Toast__description">{item.description}</div> : null}
                    {item.action ? (
                      <button
                        type="button"
                        className="itsm-Button itsm-Button--ghost itsm-Button--sm"
                        onClick={() => {
                          item.action?.onAction();
                          dismiss(item.id);
                        }}
                      >
                        {item.action.label}
                      </button>
                    ) : null}
                  </div>
                  <IconButton size="sm" label={`Dismiss: ${item.title}`} icon="✕" onClick={() => dismiss(item.id)} />
                </div>
              ))}
            </div>,
            document.body,
          )}
    </ToastContext.Provider>
  );
}

/** Throws when used outside the provider: a silently dropped error toast is worse than a crash in development. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a <ToastProvider>');
  return api;
}
