'use client';

import { useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Card, EmptyState, Icon, RelativeTime, useItsm, VisuallyHidden, type IconName } from '@itsm/ui';
import { formatList } from '@itsm/ui/format';
import type { AttentionFailure, AttentionItem, AttentionTone } from '../../server/needs-attention.js';
import { RotateCredential } from './RotateCredential.js';

/** Each tone's own shape and name, so a row never relies on its colour (SPEC §1.1). */
const TONES: Readonly<Record<AttentionTone, { readonly icon: IconName; readonly label: string }>> = {
  danger: { icon: 'circle-alert', label: 'Urgent' },
  warning: { icon: 'triangle-alert', label: 'Needs attention soon' },
  info: { icon: 'info', label: 'For information' },
};

export interface AttentionCardProps {
  readonly items: readonly AttentionItem[];
  readonly failures: readonly AttentionFailure[];
  readonly checkedAt: string;
}

/**
 * Needs attention: one prioritised list, each row an intent icon, a sentence,
 * a quiet meta line and one action (SPEC §6.1). When the list is empty and
 * every source answered, the card is the success state — "Nothing needs you
 * right now · Checked just now". A source that could not be read is named at
 * the foot with *Try again*, and while any is unread the card does not claim
 * that nothing needs you.
 */
export function AttentionCard({ items, failures, checkedAt }: AttentionCardProps): ReactNode {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const clear = items.length === 0 && failures.length === 0;
  const retry = (): void => startRetry(() => router.refresh());

  return (
    <div className="app-Attention app-Refetch" data-state={clear ? 'clear' : items.length > 0 ? 'items' : 'unknown'} aria-busy={retrying || undefined}>
      <Card title="Needs attention" headerDivider={items.length > 0}>
        {items.length > 0 ? (
          <ul className="app-Attention__list">
            {items.map((item) => (
              <AttentionRow key={item.id} item={item} />
            ))}
          </ul>
        ) : clear ? (
          <EmptyState
            size="sm"
            tone="success"
            headingLevel={3}
            title="Nothing needs you right now"
            description={
              <>
                Checked <RelativeTime date={checkedAt} mode="relative" relativeStyle="long" />
              </>
            }
          />
        ) : null}
        {failures.length > 0 ? (
          <Banner
            tone="warning"
            variant="subtle"
            live={false}
            className="app-Attention__failures"
            title={items.length === 0 ? 'Some checks couldn’t run' : undefined}
            action={{ id: 'retry', label: 'Try again', icon: 'refresh-cw', variant: 'secondary' }}
            onAction={retry}
          >
            Couldn’t check {formatList(failures.map((failure) => failure.label), { locale: 'en-GB' })}.
          </Banner>
        ) : null}
      </Card>
    </div>
  );
}

function AttentionRow({ item }: { readonly item: AttentionItem }): ReactNode {
  const { Link } = useItsm();
  const tone = TONES[item.tone];
  return (
    <li className="app-Attention__item" data-tone={item.tone} data-source={item.id}>
      <Icon name={tone.icon} size="md" label={tone.label} className="app-Attention__tone" />
      <div className="app-Attention__body">
        <p className="app-Attention__title">{item.title}</p>
        {item.detail || item.at ? (
          <p className="app-Attention__meta">
            {item.detail}
            {item.detail && item.at ? <span aria-hidden="true"> · </span> : null}
            {item.at ? (
              <>
                {item.when ?? 'At'} <RelativeTime date={item.at} />
              </>
            ) : null}
          </p>
        ) : null}
        {item.rows && item.rows.length > 0 ? (
          <ul className="app-Attention__rows">
            {item.rows.map((row) => (
              <li key={row.id} className="app-Attention__row">
                {row.href ? (
                  <Link href={row.href} className="app-Attention__rowLabel">
                    {row.label}
                  </Link>
                ) : (
                  <span className="app-Attention__rowLabel">{row.label}</span>
                )}
                {row.meta || row.at ? (
                  <span className="app-Attention__rowMeta">
                    {row.meta}
                    {row.meta && row.at ? <span aria-hidden="true"> · </span> : null}
                    {row.at ? (
                      <>
                        {row.when ?? 'At'} <RelativeTime date={row.at} />
                      </>
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {item.action ? (
        <div className="app-Attention__action">
          {item.action.rotate ? (
            <RotateCredential credential={item.action.rotate.ref} context={item.title} />
          ) : (
            <Button size="sm" variant="secondary" href={item.action.href}>
              {item.action.label}
              <VisuallyHidden>: {item.title}</VisuallyHidden>
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
