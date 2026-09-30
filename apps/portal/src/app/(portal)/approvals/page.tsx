import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { EmptyState } from '@itsm/ui';
import { ApprovalsInbox, type InitialOpen } from '../../../approvals/ApprovalsInbox.js';
import { inListOrder, itemOf, openIdOf, scopeOf } from '../../../approvals/model.js';
import { readApprovals } from '../../../approvals/server.js';
import { settle } from '../../../home/settle.js';
import { mayOpen } from '../../../navigation.js';
import { apiFor, currentApprovals, currentMe, heldPermissions, requireSession } from '../../../server/session.js';
import '../../../approvals/approvals.css';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

type Params = Promise<Record<string, string | string[] | undefined>>;

/**
 * Approvals (SPEC §6.3 `/approvals`, §5.4): what is waiting on this person's
 * decision — never in the primary navigation (X-44), reached from the avatar
 * menu, the Me tab, Home's "Approval waiting · Review" row and the palette.
 *
 * *To decide* by default; *Decided* (`?show=decided`) for what they have dealt
 * with. `?open=approval:<id>` opens one in the sheet; on a full load the
 * server reads it alongside the list, so the sheet opens with its contents.
 *
 * The waiting list is the layout's (one approvals call per request, shared
 * through `cache()`), less anything this person has already answered on a
 * step that needs more than one approval. The heading stays whatever
 * happens: a list that could not be read says so under it, with Retry, and a
 * person who is not an approver is told plainly.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Params }): Promise<ReactNode> {
  const session = await requireSession();
  const [me, params] = await Promise.all([currentMe(), searchParams]);

  const header = (
    <header className="app-Approvals__header">
      <h1 className="app-Approvals__title" tabIndex={-1}>
        Approvals
      </h1>
    </header>
  );

  if (!mayOpen('/approvals', heldPermissions(me))) {
    return (
      <div className="app-Page app-Approvals">
        {header}
        <EmptyState
          tone="forbidden"
          icon="lock"
          headingLevel={2}
          title="Approvals aren’t part of your account"
          description="They’re for people who approve requests. If you expected to decide something here, ask your IT team."
          action={{ id: 'home', label: 'Back to Home', href: '/' }}
        />
      </div>
    );
  }

  const scope = scopeOf(params.show);
  const openId = openIdOf(params.open);
  const api = apiFor(session);
  const actorId = me.actor.id;

  const [read, opened] = await Promise.all([
    currentApprovals().then((open) => readApprovals(api, actorId, open, scope)),
    openId ? settle(api.approval(openId).catch((error: unknown) => (error instanceof ApiError && error.status === 404 ? ('missing' as const) : Promise.reject(error)))) : Promise.resolve(null),
  ]);

  const now = new Date();
  const list = scope === 'waiting' ? read.waiting : read.decided;
  const items = list ? inListOrder(list.map((approval) => itemOf(approval, now)), scope) : null;
  const initialOpen: InitialOpen | null = openId ? { id: openId, detail: opened?.ok ? opened.value : null } : null;

  return (
    <div className="app-Page app-Approvals">
      {header}
      <ApprovalsInbox
        scope={scope}
        items={items}
        waitingCount={read.waiting?.length ?? null}
        actorId={actorId}
        initialOpen={initialOpen}
      />
    </div>
  );
}
