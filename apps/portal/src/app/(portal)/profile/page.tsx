import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError, type SessionRow } from '@itsm/sdk';
import { Avatar, Badge, Banner, Icon } from '@itsm/ui';
import { AreaList } from '@itsm/ui/shell';
import { AppLink } from '../../AppLink.js';
import { SectionProblem } from '../../../home/SectionProblem.js';
import { settle } from '../../../home/settle.js';
import { approvalsWaitingLabel } from '../../../navigation.js';
import { AppearanceSettings } from '../../../profile/AppearanceSettings.js';
import { DEMO_NOTIFICATIONS_NOTE, languageName, organisationLines, otherChannels, sectionsFor, settingsOf, zonePlace, zoneWords } from '../../../profile/model.js';
import { NotificationSettings } from '../../../profile/NotificationSettings.js';
import { readDirectoryEntry } from '../../../profile/server.js';
import { SignedInDevices } from '../../../profile/SignedInDevices.js';
import { ZoneClock } from '../../../profile/ZoneClock.js';
import { isDemo } from '../../../server/demo.js';
import { apiFor, currentApprovals, currentAreas, currentMe, heldPermissions, requireSession } from '../../../server/session.js';
import '../../../profile/profile.css';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

/**
 * Profile (SPEC §6.3 `/profile`, F40; v3 §7.2) — the Me tab on a phone, an
 * anchor list beside the sections on a wide screen.
 *
 * **Switch area** comes first for anyone with more than one area and in every
 * demo visit (v3 §3.6, A2 §6.4): on a phone this is where the other areas
 * are, and it costs no client code (`AreaList` is a server component).
 *
 * **Account** says who the person is in words: their name and address, their
 * organisation by name, their teams by name, their language and their time
 * zone as a place with the time there now — never a code, a count of teams
 * or a permission key. It is read-only on purpose: these arrive from the
 * organisation's directory, and a box that let somebody edit what the next
 * sync overwrites would be a lie with a Save button on it.
 *
 * Then a permanent row to **Approvals** for anyone who approves (with the
 * count the avatar carries), **Notifications** (saved as they change),
 * **Appearance** on this device, and the **Devices** signed in.
 *
 * In a demo visit **Devices** is left out — the personas are shared, and one
 * visitor must not see or end another's sessions (the API refuses it anyway)
 * — and Notifications says they stay in the bell.
 *
 * Every read starts together and each section fails on its own: a profile
 * that cannot load one part is still worth showing, and says which.
 */

type SessionsRead = { readonly ok: true; readonly value: readonly SessionRow[] } | { readonly ok: false; readonly unsupported: boolean };

export default async function ProfilePage(): Promise<ReactNode> {
  const session = await requireSession();
  const me = await currentMe();
  const held = heldPermissions(me);
  const api = apiFor(session);
  const approver = held.has('approval.read');
  const demo = isDemo(me);

  const [areas, preferences, sessions, directory, approvals] = await Promise.all([
    currentAreas(),
    settle(api.notificationPreferences()),
    // A demo visit never lists sessions: there is nothing of the visitor's own to show.
    demo
      ? Promise.resolve<SessionsRead>({ ok: false, unsupported: true })
      : api.sessions().then(
          (value): SessionsRead => ({ ok: true, value }),
          (error: unknown): SessionsRead => ({ ok: false, unsupported: error instanceof ApiError && (error.status === 403 || error.status === 404) }),
        ),
    readDirectoryEntry(session, me),
    approver ? currentApprovals() : Promise.resolve(null),
  ]);

  const now = new Date();
  const name = me.actor.displayName?.trim() || 'You';
  const zone = zoneWords(me.timeZone, now, me.locale);
  const organisations = organisationLines(me.organisations);
  const showDevices = !demo && (sessions.ok || !sessions.unsupported);
  const sections = sectionsFor({ areas: areas.visible, approvals: approver, devices: showDevices });
  const waiting = approvals?.length ?? 0;

  const facts: { readonly id: string; readonly label: string; readonly value: ReactNode }[] = [
    ...(organisations.length > 0
      ? [{ id: 'organisation', label: organisations.length > 1 ? 'Organisations' : 'Organisation', value: organisations.map((line) => <span key={line} className="app-Profile__line">{line}</span>) }]
      : me.tenant
        ? [{ id: 'organisation', label: 'Organisation', value: me.tenant.name }]
        : []),
    ...(directory.teams ? [{ id: 'teams', label: directory.teams.length > 1 ? 'Teams' : 'Team', value: directory.teams.join(', ') }] : []),
    { id: 'language', label: 'Language', value: languageName(me.locale) },
    {
      id: 'zone',
      label: 'Time zone',
      value: (
        <>
          <span className="app-Profile__line">{zone.place}</span>
          {zone.now ? (
            <span className="app-Profile__sub">
              <ZoneClock timeZone={me.timeZone} locale={me.locale} initial={zone.now} />
              {zone.long ? ` · ${zone.long}` : ''}
            </span>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <div className="app-Page app-Profile">
      <header className="app-Profile__header">
        <h1 className="app-Profile__title" tabIndex={-1}>
          Profile
        </h1>
      </header>

      <div className="app-Profile__layout">
        <nav className="app-Profile__nav" aria-label="Profile sections">
          <ul className="app-Profile__navList">
            {sections.map((section) => (
              <li key={section.id}>
                <a className="app-Profile__navLink" href={`#${section.id}`}>
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="app-Profile__sections">
          {areas.visible ? (
            <section id="areas" className="app-Profile__section" aria-labelledby="areas-heading">
              <AreaList model={areas} headingId="areas-heading" />
            </section>
          ) : null}

          <section id="account" className="app-Profile__section" aria-labelledby="account-heading">
            <h2 id="account-heading" className="app-Profile__heading">
              Account
            </h2>
            <div className="app-Profile__group">
              <div className="app-Profile__row app-Profile__identity">
                <Avatar name={name} size="xl" decorative />
                <div className="app-Profile__who">
                  <p className="app-Profile__name">{name}</p>
                  {directory.email ? <p className="app-Profile__email">{directory.email}</p> : null}
                </div>
              </div>
              <dl className="app-Profile__facts">
                {facts.map((fact) => (
                  <div key={fact.id} className="app-Profile__row app-Profile__fact">
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="app-Profile__footnote">
              From your organisation’s directory, and kept in step with it. To change any of these, ask your IT team.
            </p>
          </section>

          {approver ? (
            <section id="approvals" className="app-Profile__section" aria-labelledby="approvals-heading">
              <h2 id="approvals-heading" className="app-Profile__heading">
                Approvals
              </h2>
              <div className="app-Profile__group">
                <AppLink href="/approvals" className="app-Profile__row app-Profile__link">
                  <span className="app-Profile__linkIcon" aria-hidden="true">
                    <Icon name="approvals" size="md" />
                  </span>
                  <span className="app-Profile__linkText">
                    <span className="app-Profile__linkLabel">Requests waiting on your decision</span>
                    <span className="app-Profile__linkDetail">
                      {approvals === null ? 'Couldn’t check just now' : waiting > 0 ? approvalsWaitingLabel(waiting) : 'Nothing waiting on you'}
                    </span>
                  </span>
                  {waiting > 0 ? (
                    <Badge tone="accent" emphasis="solid" aria-hidden="true">
                      {waiting > 99 ? '99+' : String(waiting)}
                    </Badge>
                  ) : null}
                  <Icon name="chevron-right" size="sm" className="app-Profile__chevron" />
                </AppLink>
              </div>
            </section>
          ) : null}

          <section id="notifications" className="app-Profile__section" aria-labelledby="notifications-heading">
            <h2 id="notifications-heading" className="app-Profile__heading">
              Notifications
            </h2>
            {demo ? <Banner tone="info" live={false} title={DEMO_NOTIFICATIONS_NOTE} /> : null}
            {preferences.ok ? (
              <NotificationSettings
                initial={settingsOf(preferences.value)}
                email={directory.email}
                zonePlace={zonePlace(me.timeZone)}
                others={otherChannels(preferences.value)}
              />
            ) : (
              <SectionProblem what="your notification settings" />
            )}
          </section>

          <section id="appearance" className="app-Profile__section" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading" className="app-Profile__heading">
              Appearance
            </h2>
            <AppearanceSettings />
          </section>

          {showDevices ? (
            <section id="devices" className="app-Profile__section" aria-labelledby="devices-heading">
              <h2 id="devices-heading" className="app-Profile__heading" tabIndex={-1}>
                Devices
              </h2>
              {sessions.ok ? <SignedInDevices sessions={sessions.value} /> : <SectionProblem what="where you’re signed in" />}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
