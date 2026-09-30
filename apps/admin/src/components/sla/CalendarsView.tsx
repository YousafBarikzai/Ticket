'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Button, DescriptionList, EmptyState, StatusPill, Surface } from '@itsm/ui';
import { formatList } from '@itsm/ui/format';
import { Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { useDrawer } from '../../client/useDrawer.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { WeekHours, type WeekHoursValue } from '../WeekHours.js';
import { NewCalendarSheet } from './NewCalendarSheet.js';
import { openDaysSummary } from './presentation.js';
import type { CalendarView, SlaHeader } from './types.js';
import { useNewFlag } from './useNewFlag.js';

/**
 * Service levels › Calendars (SPEC §6.1): the business hours SLA clocks count,
 * as cards with the week drawn as seven small bars — the old table listed
 * the days a calendar was open and never the hours.
 *
 * A calendar opens in a drawer (`?open=calendar:<key>`) with its full week
 * and the policies that use it. There is no way to change a saved calendar
 * in the API, so the drawer offers **Duplicate…**, which opens *New calendar*
 * filled in from it (`?new=1&from=<key>`).
 */
export function CalendarsView({
  header,
  calendars,
  canManage,
}: {
  readonly header: SlaHeader;
  readonly calendars: readonly CalendarView[];
  readonly canManage: boolean;
}): ReactNode {
  const drawer = useDrawer('calendar');
  const create = useNewFlag();
  const open = drawer.key ? calendars.find((calendar) => calendar.key === drawer.key) : undefined;
  const from = create.from ? calendars.find((calendar) => calendar.key === create.from) : undefined;
  const ordered = [...calendars].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));

  return (
    <div className="app-Page app-Sla">
      <PageHeader
        title="Service levels"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'new-calendar', label: 'New calendar', icon: 'plus', variant: 'primary', shortcut: 'c' } } : {})}
        onAction={(id) => {
          if (id === 'new-calendar') create.open();
        }}
      />

      {ordered.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No business hours yet"
          description="Policies use 24×7 until you add business hours."
          {...(canManage ? { action: { id: 'new-calendar', label: 'New calendar', icon: 'plus', variant: 'primary' } } : {})}
          onAction={() => create.open()}
        />
      ) : (
        <ul className="app-Calendars" aria-label="Calendars">
          {ordered.map((calendar) => (
            <li key={calendar.id}>
              <CalendarCard calendar={calendar} href={drawer.href(calendar.key)} current={drawer.key === calendar.key} onOpen={() => drawer.open(calendar.key)} />
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.name ?? 'Calendar'}
        {...(open?.isDefault ? { headerMeta: <StatusPill size="sm" tone="info" label="Default" /> } : {})}
        {...(open && canManage
          ? {
              footer: (
                <div className="app-SlaSheetFooter">
                  <Button variant="secondary" iconStart="copy" onClick={() => create.openFrom(open.key)}>
                    Duplicate…
                  </Button>
                </div>
              ),
            }
          : {})}
      >
        {open ? (
          <div className="app-CalendarDetail">
            <DescriptionList
              layout="inline"
              items={[
                { id: 'zone', label: 'Time zone', value: open.timeZone.replace(/_/g, ' ') },
                {
                  id: 'used',
                  label: 'Used by',
                  value: open.usedBy.length > 0 ? formatList(open.usedBy, { locale: 'en-GB' }) : 'No policy yet',
                  hint: 'Policies that run on this calendar, or fall back to it.',
                },
              ]}
            />
            <WeekHours label="Business hours" value={open.hours as WeekHoursValue} readOnly />
            <p className="app-CalendarDetail__note">
              Saved calendars can’t be changed, so timers already running keep counting the hours they started with.
              {canManage ? ' To change the hours, duplicate this calendar and point policies at the copy.' : ''}
            </p>
            <TechnicalKey value={open.key} label="calendar key" />
          </div>
        ) : drawer.key ? (
          <EmptyState size="sm" icon="calendar" title="That calendar no longer exists" description="It may have been removed since the link was shared." />
        ) : null}
      </Sheet>

      {canManage ? <NewCalendarSheet open={create.isOpen} onClose={create.close} calendars={calendars} {...(from ? { from } : {})} /> : null}
    </div>
  );
}

function CalendarCard({
  calendar,
  href,
  current,
  onOpen,
}: {
  readonly calendar: CalendarView;
  readonly href: string;
  readonly current: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const titleId = `calendar-${calendar.key}`;
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpen();
  };
  return (
    <Surface as="article" tone="raised" elevation="sm" padding="lg" className="app-CalendarCard" aria-labelledby={titleId} data-current={current ? '' : undefined}>
      <header className="app-CalendarCard__head">
        <h2 className="app-CalendarCard__title" id={titleId}>
          <a className="app-CalendarCard__link" href={href} onClick={follow} {...(current ? { 'aria-current': 'true' as const } : {})}>
            {calendar.name}
          </a>
        </h2>
        {calendar.isDefault ? <StatusPill size="sm" tone="info" label="Default" /> : null}
      </header>
      <p className="app-CalendarCard__meta">
        {calendar.timeZone.replace(/_/g, ' ')} · {openDaysSummary(calendar.hours)}
        {calendar.usedBy.length > 0 ? ` · used by ${calendar.usedBy.length} ${calendar.usedBy.length === 1 ? 'policy' : 'policies'}` : ''}
      </p>
      <WeekHours label={`${calendar.name}: business hours`} value={calendar.hours as WeekHoursValue} compact />
    </Surface>
  );
}
