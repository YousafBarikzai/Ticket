import 'server-only';
import type { ActionRow, Admin, CredentialRow, ErrorQueueRow, Me } from '@itsm/sdk';
import type { TabNavItem } from '@itsm/ui/shell';
import { isPending, mayOpen, routeFor, tabsFor } from '../../../../navigation.js';
import { holds, holdsAny, viewOnlyFor } from '../../../../permissions.js';
import { read, type Read } from '../../../../server/read.js';
import type { IntegrationsHeader } from '../../../../components/integrations/types.js';

/**
 * What the Integrations tabs share (SPEC §6.1 `/integrations/**`): the
 * header this person sees — the tabs they may open, with the open failed
 * deliveries counted on the first — and the reads more than one tab needs.
 *
 * Every read is its own `read()`: a tab that loses the credential list still
 * shows its actions, and says which part it could not load.
 */

/** The error queue lists at most this many (the API's own page); a full page is "200+". */
export const QUEUE_PAGE = 200;

export const ACTION_READ = ['integration.action.read', 'integration.action.manage'] as const;
export const CREDENTIAL_READ = ['integration.credential.read', 'integration.credential.manage'] as const;

export function mayReadActions(me: Me): boolean {
  return holdsAny(me, ACTION_READ);
}

export function mayReadCredentials(me: Me): boolean {
  return holdsAny(me, CREDENTIAL_READ);
}

/** The open failures, for the tab badge and the actions' health; null when this person may not read them. */
export async function openFailures(me: Me, api: Admin): Promise<Read<ErrorQueueRow[]> | null> {
  return mayReadActions(me) ? read(() => api.observe.integrations.errorQueue('open')) : null;
}

export async function actionsFor(me: Me, api: Admin): Promise<Read<ActionRow[]> | null> {
  return mayReadActions(me) ? read(() => api.observe.integrations.actions()) : null;
}

export async function credentialsFor(me: Me, api: Admin): Promise<Read<CredentialRow[]> | null> {
  return mayReadCredentials(me) ? read(() => api.observe.integrations.credentials()) : null;
}

/**
 * The header: tabs this person may open, the first carrying the count of
 * open failed deliveries (danger, "200+" when the page is full), and the
 * *View only* pill for the permission this tab's changes need.
 */
export function integrationsHeader(me: Me, write: string, open: Read<ErrorQueueRow[]> | null): IntegrationsHeader {
  const count = open?.ok ? open.value.length : 0;
  const capped = open?.ok ? open.value.length >= QUEUE_PAGE : false;
  const tabs: TabNavItem[] = tabsFor(me, 'integrations').map((tab) =>
    tab.id === 'deliveries' && count > 0
      ? {
          ...tab,
          badge: {
            value: count,
            tone: 'danger' as const,
            ...(capped ? { capped: true } : {}),
            label: `${capped ? `${count}+` : count} ${count === 1 && !capped ? 'failed delivery' : 'failed deliveries'}`,
          },
        }
      : tab,
  );
  const viewOnly = viewOnlyFor(me, 'Integrations', write);
  return { tabs, ...(viewOnly ? { viewOnly } : {}) };
}

/** A link to a page this person may open and that exists, or undefined. */
export function reachable(me: Me, href: string): string | undefined {
  const route = routeFor(href);
  return route !== null && !isPending(route) && mayOpen(me, route) ? href : undefined;
}

/**
 * The workflow behind each run a failure came from, by run id — so "From"
 * reads "Workflow · Starter onboarding" rather than an id. Needs
 * `workflow.read`; without it (or if either list fails) the row says
 * "Workflow" and nothing more.
 */
export async function runWorkflowNames(me: Me, api: Admin, rows: readonly ErrorQueueRow[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!rows.some((row) => row.source === 'workflow') || !holdsAny(me, ['workflow.read', 'workflow.manage'])) return names;
  const [workflows, failed] = await Promise.all([
    read(() => api.configure.workflows.list()),
    read(() => api.configure.workflows.runs({ limit: 200 })),
  ]);
  if (!workflows.ok || !failed.ok) return names;
  const byDefinition = new Map(workflows.value.map((workflow) => [workflow.id, workflow.name]));
  for (const run of failed.value) {
    const name = byDefinition.get(run.definitionId);
    if (name) names.set(run.id, name);
  }
  return names;
}

export function mayReplay(me: Me): boolean {
  return holds(me, 'integration.action.replay');
}

/** The origin of another app, or undefined when unset or not a URL. */
export function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
