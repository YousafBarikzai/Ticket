import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AccessView } from '../../../../../components/security/AccessView.js';
import { areaOptions, permissionViews, roleMatrix } from '../../../../../components/security/presentation.js';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { tabsFor } from '../../../../../navigation.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import '../../../../../components/security/security.css';

export const metadata: Metadata = { title: 'Access · Security' };
export const dynamic = 'force-dynamic';

/**
 * Security › Access (SPEC §6.1 `/security/access`, A5): the roles against
 * the areas of the product, and the permission registry — both built from
 * what the API returns (`GET /roles`, `GET /permissions`), so they cannot
 * drift from what it checks. Read-only.
 */
export default async function AccessPage(): Promise<ReactNode> {
  const access = await pageAccess('/security/access');
  if (!access.allowed) return <Forbidden route="/security/access" />;
  const { me, api } = access;

  const [roles, permissions] = await Promise.all([
    holds(me, 'identity.role.read') ? read(() => api.tenant.roles()) : Promise.resolve(null),
    read(() => api.tenant.permissions()),
  ]);

  const roleRows = roles?.ok ? roles.value : [];
  const views = permissions.ok ? permissionViews(permissions.value, roleRows, me.permissions) : [];

  return (
    <AccessView
      tabs={tabsFor(me, 'security')}
      matrix={roles?.ok && permissions.ok ? roleMatrix(roles.value, permissions.value) : null}
      {...(roles && !roles.ok ? { rolesProblem: roles.problem } : {})}
      permissions={views}
      {...(permissions.ok ? {} : { permissionsProblem: permissions.problem })}
      areas={areaOptions(views)}
    />
  );
}
