/**
 * The `Toaster`'s own bookkeeping, apart from the library that draws it:
 * what each live toast says (`ToastStore`) and when each one leaves
 * (`ToastTimers`).
 *
 * Kept outside sonner on purpose. Sonner pauses its timers on hover but not
 * on keyboard focus, restarts them on every update, and cannot hold a toast
 * while its *Undo* runs — and every one of those is a rule here (SPEC §4.3,
 * §4.10). So every toast is handed to sonner as persistent, and this module
 * decides when to dismiss it. Plain classes, no React: the rules are tested
 * directly.
 */
import type { NotifyOptions, NotifyProgress, NotifyTone } from '../provider/notify.js';

export interface ToastRecord {
  readonly id: string;
  readonly message: string;
  readonly description?: string;
  readonly tone: NotifyTone;
  readonly action?: NotifyOptions['action'];
  readonly undo?: () => Promise<void>;
  /** An undo is running: the button is busy and the toast holds still. */
  readonly undoing?: boolean;
  /** A promise is pending: a spinner stands in for the tone icon. */
  readonly busy?: boolean;
  readonly retryAt?: number;
  readonly progress?: NotifyProgress;
  readonly duration: number | 'persistent';
}

/** How long a toast stays, unless its caller says otherwise. */
export const TOAST_DURATION = {
  /** Confirmation of something done. */
  default: 5000,
  /** Worth a second look. */
  warning: 8000,
  /** "Undo" is offered for eight seconds (SPEC §4.10). */
  undo: 8000,
  /** "Undone" and other short follow-ups. */
  brief: 3000,
} as const;

/**
 * The rule for a toast's lifetime. A toast that asks something of the person
 * — an action, a retry, an error — stays until they deal with it (WCAG
 * 2.2.1); *Undo* is the exception, because `mod+Z` and the thing's own
 * controls remain after it has gone.
 */
export function toastDuration(options: NotifyOptions): number | 'persistent' {
  if (options.duration !== undefined) return options.duration;
  if (options.undo) return TOAST_DURATION.undo;
  if (options.action || options.retryAt !== undefined || options.tone === 'danger') return 'persistent';
  if (options.tone === 'warning') return TOAST_DURATION.warning;
  return TOAST_DURATION.default;
}

type Listener = () => void;

/** The live toasts, by id, in the order they were first shown. Records are replaced, never mutated. */
export class ToastStore {
  private readonly records = new Map<string, ToastRecord>();
  private readonly listeners = new Set<Listener>();

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(id: string): ToastRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  set(record: ToastRecord): void {
    this.records.set(record.id, record);
    this.emit();
  }

  patch(id: string, patch: Partial<Omit<ToastRecord, 'id'>>): ToastRecord | undefined {
    const current = this.records.get(id);
    if (!current) return undefined;
    const next: ToastRecord = { ...current, ...patch };
    this.records.set(id, next);
    this.emit();
    return next;
  }

  delete(id: string): void {
    if (this.records.delete(id)) this.emit();
  }

  clear(): void {
    if (this.records.size === 0) return;
    this.records.clear();
    this.emit();
  }

  /** The newest toast whose *Undo* is still on offer: the one `mod+Z` acts on. */
  readonly latestUndo = (): string | null => {
    let latest: string | null = null;
    for (const record of this.records.values()) if (record.undo && !record.undoing) latest = record.id;
    return latest;
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * One countdown per toast, all paused together while the person is reading
 * or working in the toasts (pointer over them, focus in them) and while the
 * page is hidden, and resumed with what was left — so a toast never
 * disappears under the pointer or from under a screen reader's focus.
 */
export class ToastTimers {
  private readonly entries = new Map<string, { remaining: number; startedAt: number; handle: ReturnType<typeof setTimeout> | null }>();
  private readonly holds = new Set<string>();

  constructor(
    private readonly expire: (id: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get paused(): boolean {
    return this.holds.size > 0;
  }

  /** Starts (or restarts) a toast's countdown; `persistent` stops it. */
  set(id: string, duration: number | 'persistent'): void {
    this.clear(id);
    if (duration === 'persistent') return;
    const entry = { remaining: duration, startedAt: 0, handle: null as ReturnType<typeof setTimeout> | null };
    this.entries.set(id, entry);
    if (!this.paused) this.run(id, entry);
  }

  clear(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.handle) clearTimeout(entry.handle);
    this.entries.delete(id);
  }

  clearAll(): void {
    for (const id of [...this.entries.keys()]) this.clear(id);
  }

  /** Holds every countdown for a reason (`hover`, `focus`, `hidden`) until that reason is released. */
  hold(reason: string): void {
    const wasPaused = this.paused;
    this.holds.add(reason);
    if (wasPaused) return;
    const at = this.now();
    for (const entry of this.entries.values()) {
      if (!entry.handle) continue;
      clearTimeout(entry.handle);
      entry.handle = null;
      entry.remaining = Math.max(0, entry.remaining - (at - entry.startedAt));
    }
  }

  release(reason: string): void {
    if (!this.holds.delete(reason) || this.paused) return;
    for (const [id, entry] of this.entries) this.run(id, entry);
  }

  /** Milliseconds left on a toast, or null when it has none (persistent, or gone). */
  remaining(id: string): number | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return entry.handle ? Math.max(0, entry.remaining - (this.now() - entry.startedAt)) : entry.remaining;
  }

  private run(id: string, entry: { remaining: number; startedAt: number; handle: ReturnType<typeof setTimeout> | null }): void {
    entry.startedAt = this.now();
    entry.handle = setTimeout(() => {
      this.entries.delete(id);
      this.expire(id);
    }, entry.remaining);
  }
}
