import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Forbidden } from '../../../../../../components/Forbidden.js';
import { pageAccess } from '../../../../../../server/session.js';

export const metadata: Metadata = { title: 'New form · Services & requests' };
export const dynamic = 'force-dynamic';

/**
 * `/catalogue/forms/new` — where the command palette's *New form* and old
 * links land. A new form is a name and a key, asked in a dialog over the
 * forms list (SPEC §6.1), so this page opens that dialog rather than being a
 * page of its own. The key `new` is reserved for forms for this reason.
 */
export default async function NewFormPage(): Promise<ReactNode> {
  const access = await pageAccess('/catalogue/forms/new');
  if (!access.allowed) return <Forbidden route="/catalogue/forms/new" />;
  redirect('/catalogue/forms?new=1');
}
