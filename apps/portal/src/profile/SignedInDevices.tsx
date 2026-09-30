'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionRow } from '@itsm/sdk';
import { Button, Icon, RelativeTime, VisuallyHidden, notify } from '@itsm/ui';
import { api } from '../client/api.js';
import { problemOf, reportSessionEnded } from '../client/useAction.js';
import { sessionLabel, sessionsInOrder } from './model.js';
import { useOnline } from './online.js';

/**
 * Where this person is signed in (SPEC §6.3 `/profile`, `GET /me/sessions`),
 * most recently used first, each with *Sign out* — and the offer to install
 * the portal as an app where the browser can.
 *
 * The API does not say which session is this one, so none is marked as
 * such; the confirmation says plainly that signing out the one in use signs
 * this browser out too. Signing out needs a connection: it never queues.
 */

export interface SignedInDevicesProps {
  readonly sessions: readonly SessionRow[];
}

const LazyConfirm = dynamic(() => import('@itsm/ui/overlays').then((module) => module.ConfirmDialog), { ssr: false });

export function SignedInDevices({ sessions }: SignedInDevicesProps): ReactNode {
  const online = useOnline();
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [asking, setAsking] = useState<SessionRow | null>(null);
  // The session the confirmation is about, kept while it closes: the dialog stays mounted, animates away and gives focus back.
  const [asked, setAsked] = useState<SessionRow | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rows = sessionsInOrder(sessions).filter((session) => !gone.has(session.id));

  const endSession = async (session: SessionRow): Promise<void> => {
    try {
      await api.endSession(session.id);
    } catch (error) {
      const problem = problemOf(error);
      if (problem.status === 404) {
        // Already over (signed out elsewhere, or expired): the list only catches up.
      } else if (problem.status === 401) {
        reportSessionEnded('action');
        return;
      } else {
        // The confirmation stays open with the reason under it, worded like any other refusal.
        throw error;
      }
    }
    const index = rows.findIndex((row) => row.id === session.id);
    setGone((current) => new Set(current).add(session.id));
    notify('Signed out of that session', { tone: 'success' });
    // Focus moves to the row that took its place, or the one before it (the dialog gives it back otherwise to a button that has gone).
    window.setTimeout(() => {
      const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      (buttons[Math.min(index, buttons.length - 1)] ?? document.getElementById('devices-heading'))?.focus();
    }, 0);
  };

  return (
    <div className="app-Profile__group">
      {rows.length === 0 ? (
        <p className="app-Profile__row app-Profile__note">No other sessions are recorded for you.</p>
      ) : (
        <ul ref={listRef} className="app-Devices" aria-label="Signed-in sessions">
          {rows.map((session, index) => {
            const { label, icon } = sessionLabel(session);
            return (
              <li key={session.id} className="app-Profile__row app-Devices__row">
                <span className="app-Devices__icon" aria-hidden="true">
                  <Icon name={icon} size="md" />
                </span>
                <span className="app-Devices__text">
                  <span className="app-Devices__name">{label}</span>
                  <span className="app-Devices__meta">
                    Last active <RelativeTime date={session.lastSeenAt} relativeStyle="long" />
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  {...(online ? {} : { disabledReason: 'Needs a connection' })}
                  onClick={() => {
                    setAsked(session);
                    setAsking(session);
                  }}
                >
                  Sign out
                  <VisuallyHidden>
                    {' '}
                    of {session.device?.trim() || 'a browser'}, session {index + 1} of {rows.length}
                  </VisuallyHidden>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <InstallApp />
      {asked ? (
        <LazyConfirm
          open={asking !== null}
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          spec={{
            title: 'Sign out of this session?',
            body: 'Whoever is using it will need to sign in again. If it’s the browser you’re using now, that includes you.',
            confirmLabel: 'Sign out session',
            cancelLabel: 'Keep it',
            tone: 'danger',
          }}
          onConfirm={() => endSession(asked)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ Install */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

type Offer = { readonly kind: 'prompt'; readonly event: InstallPromptEvent } | { readonly kind: 'ios' } | null;

function standalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true;
}

function isIosSafari(): boolean {
  const agent = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(agent) || (/macintosh/i.test(agent) && navigator.maxTouchPoints > 1);
}

/**
 * "Install the app": a button where the browser has offered to install
 * (`beforeinstallprompt`), the Share-sheet steps on an iPhone or iPad, and
 * nothing once it is installed or where neither applies.
 */
function InstallApp(): ReactNode {
  const [offer, setOffer] = useState<Offer>(null);

  useEffect(() => {
    if (standalone()) return;
    if (isIosSafari()) setOffer({ kind: 'ios' });
    const onPrompt = (event: Event): void => {
      event.preventDefault();
      setOffer({ kind: 'prompt', event: event as InstallPromptEvent });
    };
    const onInstalled = (): void => setOffer(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!offer) return null;
  if (offer.kind === 'ios') {
    return (
      <p className="app-Profile__row app-Profile__note">
        To add Help to your Home Screen, tap Share, then Add to Home Screen.
      </p>
    );
  }
  return (
    <div className="app-Profile__row app-Devices__install">
      <span className="app-Devices__text">
        <span className="app-Devices__name">Install the app</span>
        <span className="app-Devices__meta">Open Help from your dock or home screen, like any other app.</span>
      </span>
      <Button
        size="sm"
        variant="tinted"
        iconStart="download"
        onClick={() => {
          void offer.event.prompt();
          void offer.event.userChoice.then(() => setOffer(null)).catch(() => setOffer(null));
        }}
      >
        Install
      </Button>
    </div>
  );
}
