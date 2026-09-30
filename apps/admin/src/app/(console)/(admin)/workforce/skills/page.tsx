import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { SkillsView } from '../../../../../components/workforce/ShiftsView.js';
import { isPending, mayOpen } from '../../../../../navigation.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { workforceHeader } from '../data.js';
import '../../../../../components/command-centre/shared.css';
import '../../../../../components/workforce/workforce.css';

export const metadata: Metadata = { title: 'Skills · Workforce' };
export const dynamic = 'force-dynamic';

/** Workforce › Skills (SPEC §6.1): what routing can require of whoever takes a ticket. */
export default async function SkillsPage(): Promise<ReactNode> {
  const access = await pageAccess('/workforce/skills');
  if (!access.allowed) return <Forbidden route="/workforce/skills" />;
  const { me, api } = access;
  const header = workforceHeader(me);

  const skills = await read(() => api.observe.queues.skills());
  if (!skills.ok) {
    return (
      <div className="app-Page app-Workforce">
        <PageHeader title="Workforce" tabs={header.tabs} />
        <Card title="Skills" problem={skills.problem} />
      </div>
    );
  }
  const people = !isPending('/people') && mayOpen(me, '/people') ? '/people' : undefined;

  return (
    <SkillsView
      header={header}
      rows={[...skills.value].sort((a, b) => a.name.localeCompare(b.name)).map((skill) => ({ key: skill.key, name: skill.name, description: skill.description }))}
      {...(people ? { peopleHref: people } : {})}
    />
  );
}
