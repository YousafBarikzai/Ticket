import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { MatrixEditor } from '../../../../../components/sla/MatrixEditor.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { canManageSla, slaHeader } from '../data.js';
import '../../../../../components/sla/sla.css';

export const metadata: Metadata = { title: 'Priority matrix · Service levels' };
export const dynamic = 'force-dynamic';

/**
 * Service levels › Priority matrix (SPEC §6.1; F30): how a ticket's impact
 * and urgency become its priority — and so which of a policy's targets it
 * gets. Nine cells, saved together.
 */
export default async function MatrixPage(): Promise<ReactNode> {
  const access = await pageAccess('/sla/matrix');
  if (!access.allowed) return <Forbidden route="/sla/matrix" />;
  const { me, api } = access;
  const header = slaHeader(me);
  const matrix = await read(() => api.configure.sla.priorityMatrix());

  return (
    <div className="app-Page app-Sla">
      <PageHeader title="Service levels" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
      {matrix.ok ? (
        <Card
          title="Priority matrix"
          subtitle="Impact is how much of the organisation is affected; urgency is how soon it matters. Together they set a ticket’s priority, and the priority picks the targets."
        >
          <MatrixEditor rows={matrix.value} canManage={canManageSla(me)} />
        </Card>
      ) : (
        <Card title="Priority matrix" problem={matrix.problem} />
      )}
    </div>
  );
}
