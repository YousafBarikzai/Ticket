import { type TenantContext, authz, transaction } from '@itsm/platform';

/**
 * Ticket categories, read-only (WA2).
 *
 * `category` has been in the schema since Phase 1, and tickets, routing and AI
 * triage all hold ids into it, but nothing could list it: a screen showing a
 * ticket's category could only show its id, and a picker had nothing to pick
 * from. There is no API that maintains categories yet, so this is the read
 * side only; a tenant's tree is loaded into the table directly.
 */

export interface CategoryRow {
  id: string;
  key: string;
  name: string;
  /** The full path, `Hardware / Printing`, which is what a picker shows. */
  path: string;
  parentId: string | null;
  orgId: string | null;
  defaultGroupId: string | null;
  isActive: boolean;
}

/**
 * More than any desk's tree, and a bound on a list with no pagination: a
 * category list is configuration, read whole into a picker.
 */
const MAX_CATEGORIES = 2000;

/**
 * The categories a reader may pick from, in path order.
 *
 * Anybody who may read tickets may read these: a category names a kind of
 * work, not anybody's work. A reader without tenant-wide `ticket.read` sees
 * the tenant's own categories and their organisations', not every other
 * organisation's, for the same reason `derivePriority` reads the matrix that
 * way — an organisation's configuration is for its own tickets.
 *
 * Inactive categories are left out unless asked for. Asking is how a screen
 * names the category on an older ticket after the category was retired, which
 * it otherwise could only show as an id.
 */
export async function listCategories(ctx: TenantContext, options: { includeInactive?: boolean } = {}): Promise<CategoryRow[]> {
  authz.require(ctx, 'ticket.read');
  const tenantWide = authz.effectiveScope(ctx, 'ticket.read') === 'any';

  return transaction(ctx, async (tx) => {
    const rows = await tx.category.findMany({
      where: {
        deletedAt: null,
        ...(options.includeInactive ? {} : { isActive: true }),
        ...(tenantWide ? {} : { OR: [{ orgId: null }, { orgId: { in: [...ctx.organisationIds] } }] }),
      },
      orderBy: [{ path: 'asc' }, { id: 'asc' }],
      take: MAX_CATEGORIES,
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      path: row.path,
      parentId: row.parentId,
      orgId: row.orgId,
      defaultGroupId: row.defaultGroupId,
      isActive: row.isActive,
    }));
  });
}
