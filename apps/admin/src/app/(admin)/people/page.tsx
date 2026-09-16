import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { holds } from '../../../permissions.js';

export const metadata: Metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

/**
 * Who is on this desk.
 *
 * Read-only in this slice, and saying so is better than a disabled button:
 * creating a user, assigning a role and adding somebody to a team are three
 * writes with three different failure modes, and a half-built form that posts
 * one of them is worse than a list plus an honest note. The API has all three
 * doors; what is missing is the screen, and doc 23 carries that rather than
 * this page implying otherwise.
 *
 * What it does give an administrator is the thing that is genuinely hard to
 * get at today: seeing every account at once, including the deactivated ones,
 * and seeing which permissions their own role actually carries.
 */
export default async function PeoplePage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  if (!holds(me, 'identity.user.read') && !holds(me, 'identity.user.manage')) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot read the people on this desk"
        description="It needs identity.user.read. Ask an administrator."
      />
    );
  }

  let users: Awaited<ReturnType<typeof api.tenant.users>>;
  try {
    users = await api.tenant.users();
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The people on this desk could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>People</h1>
        <p className="itsm-Admin__lede">
          {users.length} {users.length === 1 ? 'account' : 'accounts'} on this desk. Accounts arrive from the identity
          provider, by SCIM or on first sign-in; this is what the platform holds for each of them.
        </p>
      </header>

      {users.length === 0 ? (
        <EmptyState
          title="Nobody yet"
          description="An account appears here the first time somebody signs in, or when SCIM provisions one."
        />
      ) : (
        <Table
          caption="People on this desk"
          columns={[
            { key: 'name', header: 'Name', cell: (row) => row.displayName },
            { key: 'email', header: 'Email', cell: (row) => row.email },
            {
              key: 'status',
              header: 'Status',
              cell: (row) => (
                <Badge intent={row.status === 'active' ? 'success' : 'neutral'} srPrefix="Status">
                  {row.status}
                </Badge>
              ),
            },
            {
              key: 'kind',
              header: 'Kind',
              cell: (row) => (row.isExternal ? 'External' : 'Internal'),
            },
          ]}
          rows={users}
          rowKey={(row) => row.id}
        />
      )}

      <section className="itsm-Admin__note" aria-label="What this screen cannot do yet">
        <h2>Not built yet</h2>
        <p>
          Creating an account, assigning a role and adding somebody to a team are all reachable through the API and have
          no screen here. They are three writes with three different ways to go wrong, and a form that does one of them
          would be worse than this note.
        </p>
      </section>
    </div>
  );
}
