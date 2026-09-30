import type { ReactNode } from 'react';
import { ProblemState } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { pageEntry } from '../navigation.js';
import { permissionLabel } from '../permissions.js';

/**
 * What a page shows to somebody its gate refuses (SPEC §4.10 "Forbidden").
 *
 * Inside the frame, with the page's own header kept — "Rules", then "You don't
 * have access to Rules", the permission in words, and (for people who asked
 * to see technical keys) the key to quote to an administrator, with Copy. A
 * person who followed a link from a colleague learns what to ask for rather
 * than meeting a blank page or a sign-in loop.
 *
 * The sidebar never links here: it shows only what the person may open. This
 * is for pasted links and bookmarks. The platform pages do not use it — they
 * answer 404, so as not to announce that they exist.
 *
 * Server-safe: it renders from the route alone, so a page gates with two lines.
 */
export function Forbidden({ route }: { readonly route: string }): ReactNode {
  const entry = pageEntry(route);
  const item = entry?.item;
  const tab = entry?.tab;
  const title = item?.label ?? 'This page';
  const context = tab && item?.tabs && tab.href !== item.tabs[0]?.href ? `${item.label} › ${tab.label}` : title;
  const key = entry?.read[0];

  return (
    <div className="app-Page">
      <PageHeader title={title} />
      <ProblemState
        size="lg"
        problem={{ status: 403 }}
        context={context}
        {...(key ? { permissionLabel: permissionLabel(key), permissionKey: key } : {})}
        secondaryAction={{ id: 'home', label: 'Go to Command centre', href: '/', variant: 'secondary' }}
      />
    </div>
  );
}
