import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError, type ApprovalRequest } from '@itsm/sdk';
import { EmptyState } from '@itsm/ui';
import { ApprovalDecision } from '../../../components/ApprovalDecision.js';
import { apiFor, requireSession } from '../../../server/session.js';
import { raisedAgo } from '../../../tickets/presentation.js';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

/**
 * What is waiting on this person's decision (MOD-17).
 *
 * Only what is open. A list that mixed decided approvals into undecided ones
 * would turn the one screen with a deadline on it into a reading exercise —
 * and an approval that sits for a week is a request that sits for a week,
 * which is the failure mode this whole module exists to prevent.
 */
export default async function ApprovalsPage(): Promise<ReactNode> {
  const session = await requireSession();

  let approvals: readonly ApprovalRequest[];
  try {
    approvals = (await apiFor(session).approvals()).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return <EmptyState title="Approvals are not yours to see" description="Nobody has made you an approver." />;
    }
    return (
      <EmptyState
        tone="error"
        title="Approvals could not be loaded"
        description={error instanceof ApiError ? error.message : 'The service could not be reached.'}
      />
    );
  }

  if (approvals.length === 0) {
    return <EmptyState title="Nothing waiting on you" description="When somebody needs a decision it will appear here." />;
  }

  return (
    <div className="itsm-Page">
      <h1 className="itsm-Page__heading">Approvals</h1>
      <p className="itsm-Page__lede">
        {approvals.length === 1 ? 'One decision is waiting on you.' : `${approvals.length} decisions are waiting on you.`}
      </p>

      <ul className="itsm-Approvals">
        {approvals.map((approval) => (
          <li key={approval.id} className="itsm-Approvals__row">
            <h2 className="itsm-Approvals__what">{approval.reason ?? 'A request needs your approval'}</h2>
            <p className="itsm-Approvals__meta">
              Asked{' '}
              <time dateTime={approval.requestedAt} title={approval.requestedAt}>
                {raisedAgo(approval.requestedAt)}
              </time>
            </p>
            <ApprovalDecision id={approval.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
