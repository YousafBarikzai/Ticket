import type { Me } from '@itsm/sdk';

/**
 * What the signed-in person may do, and what each permission is called.
 *
 * A pure module in a file of its own, deliberately apart from
 * `server/session.ts`. That module imports `server-only`, which is a module
 * that throws if it is ever pulled into a client bundle — exactly the property
 * that makes it useful there and the reason a test cannot import anything
 * beside it. A permission check that cannot be tested is a permission check
 * nobody has checked. The client imports this file too (the palette filters
 * its commands with it), so it holds nothing secret and fetches nothing.
 */

/** The part of `me` a permission check reads: serialisable, so a client component can be handed it. */
export interface Grants {
  readonly permissions: readonly { readonly key: string; readonly scope?: string | null }[];
}

/**
 * Exact match, at any scope.
 *
 * Never a prefix: `platform.tenant.read` must not satisfy
 * `platform.tenant.manage`, and a bare `platform` must satisfy nothing. The
 * scope is deliberately ignored here — every use in this console is "may this
 * person reach this screen at all", and a screen that needs a particular scope
 * says so where it needs it.
 */
export function holds(me: Me | Grants, permission: string): boolean {
  return me.permissions.some((granted) => granted.key === permission);
}

/**
 * Any one of `permissions` — the shape of every read gate in this console
 * (SPEC §5.1). An empty list is open to everyone signed in: the Command
 * centre, which filters its own sections.
 */
export function holdsAny(me: Me | Grants, permissions: readonly string[]): boolean {
  return permissions.length === 0 || permissions.some((permission) => holds(me, permission));
}

/**
 * Permissions in words, for the places a person reads them: the *View only*
 * pill, the Forbidden view, "Not available to you" on the Command centre.
 *
 * Raw keys are for the people who asked to see them (*Show technical keys*,
 * X-11); everyone else is told what to ask an administrator for in the
 * language an administrator's role editor uses. A key missing here still reads
 * sensibly through `permissionLabel`'s fallback.
 */
export const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'admin.activity.read': 'Read recent activity',
  'admin.flag.manage': 'Manage feature flags',
  'admin.module.manage': 'Manage modules',
  'admin.setting.manage': 'Manage settings',
  'admin.setting.read': 'Read settings',
  'ai.manage': 'Manage AI',
  'ai.read': 'Read AI triage',
  'ai.suggest': 'Ask AI for suggestions',
  'analytics.manage': 'Manage insights',
  'analytics.read': 'Read insights',
  'asset.manage': 'Manage assets',
  'asset.read': 'Read assets',
  'audit.export': 'Export the audit log',
  'audit.read': 'Read the audit log',
  'catalogue.form.manage': 'Manage forms',
  'catalogue.form.read': 'Read forms',
  'catalogue.manage': 'Manage services and request types',
  'cmdb.manage': 'Manage configuration items',
  'cmdb.read': 'Read configuration items',
  'identity.org.manage': 'Manage teams and organisations',
  'identity.org.read': 'Read teams and organisations',
  'identity.role.manage': 'Manage roles',
  'identity.role.read': 'Read roles',
  'identity.user.manage': 'Manage people',
  'identity.user.read': 'Read people',
  'incident.major.read': 'Read major incidents',
  'integration.action.manage': 'Manage integration actions',
  'integration.action.read': 'Read integration actions',
  'integration.action.replay': 'Replay failed deliveries',
  'integration.credential.manage': 'Manage credentials',
  'integration.credential.read': 'Read credentials',
  'notification.read': 'Read notifications',
  'platform.tenant.manage': 'Operate the platform',
  'rules.rule.manage': 'Manage rules',
  'rules.rule.publish': 'Publish rules',
  'rules.rule.read': 'Read rules',
  'security.alert.read': 'Read security alerts',
  'sla.policy.manage': 'Manage service levels',
  'sla.policy.read': 'Read service levels',
  'tenant.limit.manage': 'Manage usage limits',
  'tenant.usage.read': 'Read usage and plan',
  'ticket.config.manage': 'Manage ticket fields',
  'ticket.read': 'Read tickets',
  'webhook.manage': 'Manage webhooks',
  'webhook.read': 'Read webhooks',
  'workflow.manage': 'Manage workflows',
  'workflow.operate': 'Operate workflow runs',
  'workflow.publish': 'Publish workflows',
  'workflow.read': 'Read workflows',
  'workload.availability.set': 'Set availability',
  'workload.manage': 'Manage workforce',
  'workload.oncall.override': 'Cover on-call',
  'workload.read': 'Read workforce',
};

/**
 * A permission in words: the catalogue's name, or one built from the key —
 * `feedback.survey.manage` reads "Manage feedback survey" — so a permission
 * added to a module before this list is still something a person can ask for.
 */
export function permissionLabel(key: string): string {
  const known = PERMISSION_LABELS[key];
  if (known) return known;
  const parts = key.split('.').filter(Boolean);
  const verb = parts.length > 1 ? parts[parts.length - 1]! : 'use';
  const nouns = (parts.length > 1 ? parts.slice(0, -1) : parts)
    .join(' ')
    .replace(/[_-]/g, ' ')
    .replace(/\b(ai|sla|cmdb|api)\b/g, (word) => word.toUpperCase());
  const sentence = `${verb} ${nouns}`.trim();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * The page header's *View only* pill (D19, X-47), or nothing when the person
 * may change what the page shows.
 *
 * `write` is the permission the page's changes need — any one of them, like
 * every gate here. Pass the result straight to `PageHeader viewOnly`:
 *
 * ```tsx
 * <PageHeader title="Rules" viewOnly={viewOnlyFor(me, 'Rules', ['rules.rule.manage'])} … />
 * ```
 *
 * Buttons for the missing permission are hidden, not disabled; this pill is
 * how the page says so, once, in words, with the key for people who asked to
 * see keys.
 */
export function viewOnlyFor(
  me: Me | Grants,
  label: string,
  write: string | readonly string[],
): { readonly label: string; readonly permission: string; readonly key: string } | undefined {
  const keys = typeof write === 'string' ? [write] : write;
  if (keys.length === 0 || holdsAny(me, keys)) return undefined;
  const key = keys[0]!;
  return { label, permission: permissionLabel(key), key };
}
