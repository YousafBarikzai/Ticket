/**
 * The shared, serialisable types of the design system (SPEC §4.0).
 *
 * They are the vocabulary the component signatures are written in, and most of
 * them exist for one reason: a server component can pass a *description* of an
 * action, an empty state or an error to a client component, where it could
 * never pass a function. `ActionSpec` says "a button labelled Publish rule that
 * asks first"; the client component that renders it owns the behaviour. Keep
 * everything here plain data — a function-valued field would compile and then
 * fail at the server/client boundary, which is the worst place to find out.
 *
 * Types only: nothing here renders or runs, so any module may import it.
 */
import type { AnchorHTMLAttributes, ComponentType } from 'react';

export type { IconName } from './icons/registry.js';
import type { IconName } from './icons/registry.js';

/** Colour intent of a notice, pill, badge or chart status. Never the only carrier of meaning. */
export type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

/** Control and component size. `md` is every component's default. */
export type Size = 'sm' | 'md' | 'lg';

/**
 * A noun in both numbers, for counts ("1 ticket", "3 tickets"). An object
 * rather than a function so a server component can pass it.
 */
export type Plural = { one: string; other: string };

/**
 * Button emphasis, from the one primary action on a surface down to `ghost`
 * for toolbar controls. `dangerTinted` is the destructive action that is not
 * the main one (Delete in an overflow of a settings page).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger' | 'dangerTinted';

/** A serialisable description of an action: what it is called, where it goes and whether it asks first. */
export interface ActionSpec {
  id: string;
  label: string;
  icon?: IconName;
  href?: string;
  external?: boolean;
  variant?: ButtonVariant;
  tone?: 'default' | 'danger';
  shortcut?: string;
  disabled?: boolean;
  /** Why it is disabled — for state gates only (offline, invalid), never for a missing permission (D19). */
  disabledReason?: string;
  confirm?: ConfirmSpec;
}

/** What a confirmation asks, and what it needs before it lets the action through. */
export interface ConfirmSpec {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  requireReason?: boolean | { label: string; hint?: string; minLength?: number };
  /** The text the person must type to confirm, e.g. a credential reference or a tenant slug. */
  typeToConfirm?: string;
  /** What else depends on the thing being changed: "Used by 2 rules" (X-51). */
  consequences?: { label: string; href?: string }[];
}

/** One step of a breadcrumb trail. The current page has no `href`. */
export interface Crumb {
  label: string;
  href?: string;
}

/** The line illustrations of the large empty and status screens. */
export type Illustration =
  | 'inbox'
  | 'search'
  | 'error'
  | 'success'
  | 'forbidden'
  | 'offline'
  | 'empty-chart'
  | 'catalogue'
  | 'setup';

/** An empty state as data, for components that render one on the caller's behalf (tables, cards, feeds). */
export interface EmptySpec {
  title: string;
  description?: string;
  icon?: IconName;
  illustration?: Illustration;
  action?: ActionSpec;
  secondaryAction?: ActionSpec;
}

/**
 * An API error, serialised: what a server component caught, handed to the
 * client component that explains it. Mirrors the SDK's `ApiError` without
 * importing it — the design system knows nothing about the API.
 */
export interface Problem {
  status: number;
  code?: string;
  title?: string;
  detail?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string>;
  /** Next's error digest, shown as "Error ID" so a person can quote it to support. */
  digest?: string;
}

/**
 * The application's link component, handed to `ItsmProvider`. The design
 * system never imports `next/link`; each app passes its own, so client-side
 * navigation and prefetching work without the package depending on Next.
 */
export type LinkComponent = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean | null;
    replace?: boolean;
    scroll?: boolean;
  }
>;
