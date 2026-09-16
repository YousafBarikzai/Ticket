import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { NotificationPreference } from '@itsm/sdk';
import { Badge, Card, EmptyState } from '@itsm/ui';
import { apiFor, requireSession } from '../../../server/session.js';
import { NotificationPreferences } from '../../../components/NotificationPreferences.js';
import { ThemeChoice } from '../../../components/ThemeChoice.js';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

/**
 * The fifth item in the brief's navigation, and the one that did not exist.
 *
 * `/me/notification-preferences` has been served since MOD-11-E1 with nothing
 * calling it — a person could be told about their tickets in the app or by
 * e-mail, and had no way to say which, or to ask for a daily summary instead
 * of a message per event.
 *
 * What is deliberately not here: a person cannot change their own name,
 * organisation or team. Those arrive from the identity provider through SCIM
 * (MOD-01), and a box that let somebody edit a field the next sync overwrites
 * would be a lie with a Save button on it. The page says where they come from
 * instead.
 */
export default async function ProfilePage(): Promise<ReactNode> {
  const session = await requireSession();
  const api = apiFor(session);

  const me = await api.me();

  let preferences: readonly NotificationPreference[] = [];
  let preferencesFailed = false;
  try {
    preferences = await api.notificationPreferences();
  } catch {
    // Failing softly: a profile that cannot load one section is still worth
    // showing, and the section says so itself below.
    preferencesFailed = true;
  }

  const details: readonly { label: string; value: string }[] = [
    { label: 'Name', value: me.actor.displayName ?? 'Not set' },
    { label: 'Organisation', value: me.tenant?.name ?? '—' },
    { label: 'Teams', value: me.teamIds.length === 0 ? 'None' : String(me.teamIds.length) },
    { label: 'Language', value: me.locale },
    { label: 'Time zone', value: me.timeZone },
  ];

  return (
    <div className="itsm-Page">
      <h1 className="itsm-Page__heading">Profile</h1>
      <p className="itsm-Page__lede">Who you are on this service desk, and how it gets in touch.</p>

      <div className="itsm-Profile">
        <Card title="You">
          <dl className="itsm-Details">
            {details.map((detail) => (
              <div className="itsm-Details__row" key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
          <p className="itsm-Page__footnote">
            These come from your organisation&rsquo;s directory and are kept in step with it automatically. Ask your IT
            team to change them there rather than here.
          </p>
        </Card>

        <Card title="How we get in touch">
          {preferencesFailed ? (
            <EmptyState
              tone="error"
              title="Your notification settings could not be loaded"
              description="Everything else on this page is up to date. Try again in a moment."
            />
          ) : (
            <NotificationPreferences preferences={preferences} />
          )}
        </Card>

        <Card title="Appearance">
          <ThemeChoice />
        </Card>

        <Card title="What you can do here">
          {me.permissions.length === 0 ? (
            <EmptyState title="No permissions" description="Ask your IT team if you expected to be able to do more." />
          ) : (
            <ul className="itsm-Chips">
              {me.permissions.map((permission) => (
                <li key={`${permission.key}:${permission.scope ?? ''}`}>
                  <Badge srPrefix="Permission">{permission.key}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
