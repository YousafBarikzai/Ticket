'use client';

import { useEffect, useRef, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon, StatusPill, channelInfo } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import type { PopularAnswer, StatusSummary } from './model.js';

/**
 * Home's "Good to know" card (SPEC §6.3, X-34, C-P3): how the services are
 * doing right now, the three answers people read most, and the other ways to
 * reach the desk. Each part shows only when it has something true to say —
 * no status page, no status; fewer than three popular answers, no list; no
 * channels configured, no line.
 *
 * The status is refreshed when the person comes back to the tab: the page is
 * redrawn from the server (at most once a minute), because the status page
 * sends no live notices to requesters.
 */

/** A tab that comes back sooner than this is not asked again. */
export const REFRESH_EVERY_MS = 60_000;

export interface GoodToKnowProps {
  /** Null: no public status page. */
  readonly status: StatusSummary | null;
  /** The status page could not be read just now. */
  readonly statusFailed: boolean;
  readonly answers: readonly PopularAnswer[];
  readonly channels: readonly string[];
  /** The person may read help articles: the Knowledge link stands in when nothing else is here. */
  readonly canBrowseKnowledge: boolean;
  /** When the server drew this (ISO), so a refresh on focus waits its minute. */
  readonly drawnAt: string;
}

function useRefreshOnFocus(drawnAt: string): boolean {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const last = useRef(Date.parse(drawnAt) || Date.now());
  useEffect(() => {
    last.current = Date.parse(drawnAt) || Date.now();
  }, [drawnAt]);
  useEffect(() => {
    const onReturn = (): void => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (Date.now() - last.current < REFRESH_EVERY_MS) return;
      last.current = Date.now();
      startRefresh(() => router.refresh());
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [router]);
  return refreshing;
}

export function GoodToKnow({ status, statusFailed, answers, channels, canBrowseKnowledge, drawnAt }: GoodToKnowProps): ReactNode {
  const refreshing = useRefreshOnFocus(drawnAt);
  const nothingElse = !status && !statusFailed && answers.length === 0 && channels.length === 0;
  if (nothingElse && !canBrowseKnowledge) return null;

  return (
    <Card as="section" title="Good to know" titleAs="h2" className="app-Home__aside" aria-busy={refreshing || undefined}>
      <div className="app-Good">
        {status ? (
          <section className="app-Good__part" aria-labelledby="home-status">
            <h3 id="home-status" className="app-Good__title">
              Service status
            </h3>
            <p className="app-Good__overall">
              <StatusPill label={status.overall.label} tone={status.overall.tone} icon={status.overall.icon} />
            </p>
            {status.components.length > 0 ? (
              <ul className="app-Good__components">
                {status.components.map((component) => (
                  <li key={component.key} className="app-Good__component">
                    <span className="app-Good__componentName">{component.name}</span>
                    <StatusPill size="sm" label={component.state.label} tone={component.state.tone} icon={component.state.icon} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : statusFailed ? (
          <p className="app-Good__quiet">
            <Icon name="cloud-off" size="sm" /> Couldn’t check service status just now.
          </p>
        ) : null}

        {answers.length > 0 ? (
          <section className="app-Good__part" aria-labelledby="home-popular">
            <h3 id="home-popular" className="app-Good__title">
              Popular answers
            </h3>
            <ul className="app-Good__links">
              {answers.map((answer) => (
                <li key={answer.key}>
                  <AppLink className="app-Good__link" href={`/knowledge/${encodeURIComponent(answer.key)}`}>
                    <Icon name="knowledge" size="sm" className="app-Good__linkIcon" />
                    <span>{answer.title}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {channels.length > 0 ? (
          <section className="app-Good__part" aria-labelledby="home-channels">
            <h3 id="home-channels" className="app-Good__title">
              Other ways to reach us
            </h3>
            <ul className="app-Good__channels">
              {channels.map((channel) => {
                const info = channelInfo(channel);
                return (
                  <li key={channel} className="app-Good__channel">
                    <Icon name={info.icon} size="sm" />
                    <span>{info.label}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {nothingElse && canBrowseKnowledge ? (
          <p className="app-Good__quiet">
            <AppLink className="app-Good__link" href="/knowledge">
              <Icon name="knowledge" size="sm" className="app-Good__linkIcon" />
              <span>Browse help articles</span>
            </AppLink>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
