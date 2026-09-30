'use client';

import { useMemo, useRef, type ReactNode } from 'react';
import { Button } from '@itsm/ui';
import { Dialog, Sheet } from '@itsm/ui/overlays';
import { CommandPalette } from '@itsm/ui/shell';
import { useTheme } from '@itsm/ui/theme';
import { useAdminPalette } from '../client/palette.js';
import { permissionLabel, type Grants } from '../permissions.js';

/**
 * The frame's overlays, in a module of their own so that the first page load
 * does not carry them: the command palette (⌘K), *Your access* and "Your
 * session ended". `AdminShell` imports this lazily — when the browser is idle,
 * or the moment one of them is wanted.
 */

/* -------------------------------------------------------------------------
 * The command palette
 * ---------------------------------------------------------------------- */

export function AdminPalette({
  grants,
  open,
  onOpenChange,
}: {
  readonly grants: Grants;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { providers, fallback } = useAdminPalette(grants);
  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      providers={providers}
      fallback={fallback}
      label="Search and commands"
      placeholder="Search or jump to…"
    />
  );
}

/* -------------------------------------------------------------------------
 * Your access
 * ---------------------------------------------------------------------- */

const MODULE_NAMES: Readonly<Record<string, string>> = {
  admin: 'Settings',
  ai: 'AI',
  analytics: 'Insights',
  approval: 'Approvals',
  asset: 'Assets',
  audit: 'Audit',
  catalogue: 'Service catalogue',
  change: 'Changes',
  channel: 'Channels',
  cmdb: 'Configuration items',
  contract: 'Contracts',
  discovery: 'Discovery',
  feedback: 'Feedback',
  identity: 'People and access',
  incident: 'Major incidents',
  integration: 'Integrations',
  knowledge: 'Knowledge',
  notification: 'Notifications',
  platform: 'Platform',
  problem: 'Problems',
  rules: 'Rules',
  search: 'Search',
  security: 'Security',
  sla: 'Service levels',
  statuspage: 'Status page',
  tenant: 'This workspace',
  ticket: 'Tickets',
  time: 'Time',
  webhook: 'Webhooks',
  workflow: 'Workflows',
  workload: 'Workforce',
};

const SCOPE_NAMES: Readonly<Record<string, string>> = {
  any: 'Everywhere',
  team: 'Your teams',
  own: 'Your own',
  organisation: 'Your organisation',
};

/** Permissions grouped by area, in words, each once at its widest scope. Pure, for the test. */
export function accessGroups(grants: Grants): { readonly area: string; readonly entries: { key: string; label: string; scope: string | null }[] }[] {
  const widest = new Map<string, string | null>();
  const rank = (scope: string | null | undefined): number => (scope === 'any' ? 3 : scope === 'organisation' ? 2 : scope === 'team' ? 1 : 0);
  for (const permission of grants.permissions) {
    const current = widest.get(permission.key);
    if (current === undefined || rank(permission.scope) > rank(current)) widest.set(permission.key, permission.scope ?? null);
  }
  const groups = new Map<string, { key: string; label: string; scope: string | null }[]>();
  for (const [key, scope] of widest) {
    const prefix = key.split('.')[0] ?? key;
    const area = MODULE_NAMES[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
    const list = groups.get(area) ?? [];
    list.push({ key, label: permissionLabel(key), scope });
    groups.set(area, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en-GB'))
    .map(([area, entries]) => ({ area, entries: entries.sort((a, b) => a.label.localeCompare(b.label, 'en-GB')) }));
}

/**
 * *Your access*: what this person may do on this desk, in words, grouped by
 * area — the answer to "why can't I see Rules?" without asking anyone. Keys
 * appear only for people who turned on *Show technical keys*.
 */
export function AccessSheet({
  grants,
  open,
  onOpenChange,
}: {
  readonly grants: Grants;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { prefs } = useTheme();
  const groups = useMemo(() => accessGroups(grants), [grants]);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      title="Your access"
      description="What your roles let you do on this desk. An administrator changes roles under People."
      size="sm"
    >
      {groups.length === 0 ? (
        <p className="app-Access__empty">Your account holds no permissions on this desk.</p>
      ) : (
        <div className="app-Access">
          {groups.map((group) => (
            <section key={group.area} className="app-Access__group" aria-label={group.area}>
              <h3 className="app-Access__area">{group.area}</h3>
              <ul className="app-Access__list">
                {group.entries.map((entry) => (
                  <li key={entry.key} className="app-Access__item">
                    <span className="app-Access__label">{entry.label}</span>
                    {entry.scope && SCOPE_NAMES[entry.scope] ? <span className="app-Access__scope">{SCOPE_NAMES[entry.scope]}</span> : null}
                    {prefs.showKeys ? <code className="app-Access__key">{entry.key}</code> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/* -------------------------------------------------------------------------
 * Your session ended
 * ---------------------------------------------------------------------- */

/**
 * A write came back 401 (D15): the person acted, so the answer is a dialog
 * with focus on *Sign in again* — which comes back to this page. *Not now*
 * keeps the page as it is; the frame's banner keeps saying why saving fails.
 */
export function SessionEndedDialog({
  open,
  onDismiss,
  onSignIn,
}: {
  readonly open: boolean;
  readonly onDismiss: () => void;
  readonly onSignIn: () => void;
}): ReactNode {
  const signIn = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog
      open={open}
      onClose={() => onDismiss()}
      role="alertdialog"
      size="sm"
      title="Your session ended"
      initialFocusRef={signIn}
      footer={
        <>
          <Button variant="secondary" onClick={onDismiss}>
            Not now
          </Button>
          <Button ref={signIn} variant="primary" onClick={onSignIn}>
            Sign in again
          </Button>
        </>
      }
    >
      <p>Sign in again to save your change. You’ll come back to this page.</p>
    </Dialog>
  );
}
