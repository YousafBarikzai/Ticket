import type { ReactNode } from 'react';
import { requirePlatformOperator } from '../../../server/session.js';

/**
 * The platform operator's section, and the gate on it.
 *
 * These screens are not a tenant's. They list every tenant on the deployment
 * and the price list every one of them is sold against, and the audience is
 * whoever runs the platform rather than whoever runs a desk. They sit in the
 * same frame as the tenant pages (`(console)/layout.tsx`), so an operator
 * keeps the sidebar; this layout adds nothing to it but the gate.
 *
 * The gate is here, in the *layout*, rather than on each page. A per-page
 * check is one page away from being forgotten, and the page somebody forgets
 * is the one that enumerates every customer. Next renders a segment's layout
 * before any page inside it, so a route added to this directory later is
 * behind the check by construction rather than by remembering.
 *
 * `requirePlatformOperator` calls `notFound()` rather than returning a 403.
 * "You may not see this" tells somebody there is a platform section and that
 * they are one permission away from it; a 404 tells them nothing they did not
 * already know. For the answer to stay a 404 on the wire, no `loading.tsx` may
 * sit above this layout — a streamed skeleton would have sent a 200 first
 * (Y-1.3.3); loading files for these pages go *below* it.
 *
 * None of this is the security boundary. The API refuses these calls without
 * `platform.tenant.manage` whatever this layout does — no role in the shipped
 * role seed holds it. This is the console not offering what it cannot deliver.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requirePlatformOperator();
  return children;
}
