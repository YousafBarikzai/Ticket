import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

/*
 * The skeleton family: placeholders shaped like the content they stand in for.
 *
 * Server-safe, because they are what a route's `loading.tsx` streams first.
 * The timing is all CSS — shimmer revealed after 200 ms, the "Loading …"
 * status after 1 s, "Still loading…" after 10 s — so a fast response never
 * flashes a skeleton and no timer runs on the client. The shapes are
 * `aria-hidden`; only the container speaks.
 *
 * `Skeleton` and `SkeletonText` stay in `web/Skeleton.tsx`, where applications
 * import them from today.
 *
 * Stub (SPEC §4.5): each renders a hidden placeholder element; the feedback
 * package draws the shapes and the delayed status.
 */

export interface SkeletonAvatarProps {
  readonly size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  readonly className?: string;
}

export function SkeletonAvatar({ size = 'md', className }: SkeletonAvatarProps): ReactNode {
  return <span aria-hidden="true" className={cx('itsm-SkeletonAvatar', className)} data-size={size} />;
}

export interface SkeletonStatProps {
  readonly className?: string;
}

/** Stands in for a `StatCard`. */
export function SkeletonStat({ className }: SkeletonStatProps): ReactNode {
  return <div aria-hidden="true" className={cx('itsm-SkeletonStat', className)} />;
}

export interface SkeletonCardProps {
  /** Lines of body text. */
  readonly lines?: number;
  readonly className?: string;
}

export function SkeletonCard({ lines = 3, className }: SkeletonCardProps): ReactNode {
  return <div aria-hidden="true" className={cx('itsm-SkeletonCard', className)} data-lines={lines} />;
}

export interface SkeletonTableProps {
  readonly rows?: number;
  readonly columns?: number;
  readonly className?: string;
}

export function SkeletonTable({ rows = 8, columns = 4, className }: SkeletonTableProps): ReactNode {
  return <div aria-hidden="true" className={cx('itsm-SkeletonTable', className)} data-rows={rows} data-columns={columns} />;
}

export interface SkeletonListProps {
  readonly rows?: number;
  readonly className?: string;
}

export function SkeletonList({ rows = 8, className }: SkeletonListProps): ReactNode {
  return <div aria-hidden="true" className={cx('itsm-SkeletonList', className)} data-rows={rows} />;
}

export interface SkeletonConversationProps {
  readonly messages?: number;
  readonly className?: string;
}

/** Stands in for a ticket's conversation. */
export function SkeletonConversation({ messages = 3, className }: SkeletonConversationProps): ReactNode {
  return <div aria-hidden="true" className={cx('itsm-SkeletonConversation', className)} data-messages={messages} />;
}

export type SkeletonPageVariant = 'list' | 'detail' | 'dashboard' | 'form' | 'workspace' | 'inbox' | 'settings';

export interface SkeletonPageProps {
  readonly variant: SkeletonPageVariant;
  /** What is loading, for the delayed status: "Loading tickets…". */
  readonly label?: string;
  readonly className?: string;
}

/** A whole route's placeholder, for `loading.tsx`: carries `aria-busy` and the delayed status. */
export function SkeletonPage({ variant, className }: SkeletonPageProps): ReactNode {
  return <div aria-busy="true" className={cx('itsm-SkeletonPage', className)} data-variant={variant} />;
}
