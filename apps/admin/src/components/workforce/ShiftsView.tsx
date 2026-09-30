'use client';

import type { ReactNode } from 'react';
import { Avatar, Button, DescriptionList, EmptyState, StatusPill, useItsm } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { useDrawer } from '../../client/useDrawer.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { WeekHours, type WeekHoursValue } from '../WeekHours.js';
import { assignmentSpan } from './presentation.js';
import type { ShiftView, SkillView, WorkforceHeader } from './types.js';

/**
 * Workforce › Shifts (SPEC §6.1): each weekly pattern with its team, time
 * zone, the week drawn as seven small bars and who is on it today; a row
 * opens the shift (`?open=shift:<key>`) with its full week and everyone
 * assigned, past and future. Read-only here: shift writes are [Plus].
 */
export function ShiftsView({ header, rows, teams }: { readonly header: WorkforceHeader; readonly rows: readonly ShiftView[]; readonly teams: boolean }): ReactNode {
  const { locale } = useItsm();
  const drawer = useDrawer('shift');
  const open = drawer.key ? rows.find((row) => row.key === drawer.key) : undefined;

  const columns: ColumnSpec[] = [
    { id: 'name', header: 'Shift', field: 'name', kind: 'title', width: '2fr', minWidth: 180 },
    ...(teams ? [{ id: 'team', header: 'Team', field: 'teamName', kind: 'text' as const, width: '1fr' as const, hideBelow: 'md' as const, empty: 'No team' }] : []),
    { id: 'zone', header: 'Time zone', field: 'timeZone', kind: 'text', width: '1fr', hideBelow: 'lg' },
    { id: 'pattern', header: 'Pattern', field: 'key', kind: 'text', width: 180, hideBelow: 'sm' },
    { id: 'people', header: 'On it today', field: 'people', kind: 'people', width: '1fr', empty: 'Nobody' },
    { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, hideBelow: 'lg', width: '1fr' },
  ];

  return (
    <div className="app-Page app-Workforce">
      <PageHeader title="Workforce" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
      <h2 className="itsm-visually-hidden">Shifts</h2>
      <DataTable<ShiftView>
        caption="Shifts"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="key"
        urlKey=""
        search={{ placeholder: 'Search shifts', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'drawer', openKind: 'shift', keyField: 'key' }}
        onActivate={(row) => drawer.open(row.key)}
        {...(drawer.key ? { currentKeys: [drawer.key] } : {})}
        pagination={{ mode: 'none' }}
        countNoun={{ one: 'shift', other: 'shifts' }}
        cells={{
          pattern: (row) => <WeekHours label={`${row.name}: pattern`} value={row.hours as WeekHoursValue} compact />,
        }}
        empty={{ title: 'No shifts', description: 'The desk is treated as always open unless an SLA calendar says otherwise.', icon: 'calendar' }}
        noResults={{ title: 'No shifts match', description: 'Try another word.' }}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.name ?? 'Shift'}
        {...(open?.teamName ? { description: open.teamName } : {})}
      >
        {open ? (
          <div className="app-ShiftDetail">
            <DescriptionList layout="inline" items={[{ id: 'zone', label: 'Time zone', value: open.timeZone.replace(/_/g, ' ') }]} />
            <WeekHours label="Pattern" value={open.hours as WeekHoursValue} readOnly />
            <section aria-labelledby="shift-people">
              <h3 id="shift-people" className="app-ShiftDetail__heading">
                People
              </h3>
              {open.assignments.length === 0 ? (
                <p className="app-ShiftDetail__note">Nobody is assigned to this shift.</p>
              ) : (
                <ul className="app-ShiftDetail__people">
                  {open.assignments.map((entry) => (
                    <li key={entry.id}>
                      <Avatar name={entry.person.name ?? 'Unknown person'} size="sm" decorative />
                      <span className="app-ShiftDetail__person">{entry.person.name ?? 'Unknown person'}</span>
                      <span className="app-ShiftDetail__span">{assignmentSpan(entry.startsOn, entry.endsOn, locale)}</span>
                      {entry.current ? <StatusPill size="sm" tone="success" label="On it now" /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <TechnicalKey value={open.key} label="shift key" />
          </div>
        ) : drawer.key ? (
          <EmptyState size="sm" icon="calendar" title="That shift no longer exists" description="It may have been removed since the link was shared." />
        ) : null}
      </Sheet>
    </div>
  );
}

/**
 * Workforce › Skills (SPEC §6.1): what routing can ask for. A skill's drawer
 * (`?open=skill:<key>`) explains itself; who holds a skill is granted and
 * shown on each person in People — the API has no per-skill member list.
 */
export function SkillsView({ header, rows, peopleHref }: { readonly header: WorkforceHeader; readonly rows: readonly SkillView[]; readonly peopleHref?: string }): ReactNode {
  const drawer = useDrawer('skill');
  const open = drawer.key ? rows.find((row) => row.key === drawer.key) : undefined;

  return (
    <div className="app-Page app-Workforce">
      <PageHeader title="Workforce" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
      <h2 className="itsm-visually-hidden">Skills</h2>
      <DataTable<SkillView>
        caption="Skills"
        captionHidden
        columns={[
          { id: 'name', header: 'Skill', field: 'name', kind: 'title', secondaryField: 'description', truncate: 2, width: '2fr', minWidth: 220 },
          { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, width: '1fr' },
        ]}
        rows={rows}
        rowKey="key"
        urlKey=""
        search={{ placeholder: 'Search skills', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'drawer', openKind: 'skill', keyField: 'key' }}
        onActivate={(row) => drawer.open(row.key)}
        {...(drawer.key ? { currentKeys: [drawer.key] } : {})}
        pagination={{ mode: 'none' }}
        countNoun={{ one: 'skill', other: 'skills' }}
        empty={{ title: 'No skills', description: 'Skill-based routing has nothing to match on until skills exist.', icon: 'star' }}
        noResults={{ title: 'No skills match', description: 'Try another word.' }}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="sm"
        title={open?.name ?? 'Skill'}
      >
        {open ? (
          <div className="app-SkillDetail">
            <p>{open.description ?? 'No description.'}</p>
            <p className="app-ShiftDetail__note">
              Skills are granted to people, with a level, from each person’s page in People. There is no list of everyone with a skill yet.
            </p>
            {peopleHref ? (
              <Button variant="secondary" size="sm" href={peopleHref} iconEnd="chevron-right">
                Go to People
              </Button>
            ) : null}
            <TechnicalKey value={open.key} label="skill key" />
          </div>
        ) : drawer.key ? (
          <EmptyState size="sm" icon="star" title="That skill no longer exists" description="It may have been removed since the link was shared." />
        ) : null}
      </Sheet>
    </div>
  );
}
