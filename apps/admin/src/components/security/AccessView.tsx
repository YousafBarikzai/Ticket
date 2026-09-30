'use client';

import { useMemo, useRef, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Icon, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { PageHeader, type TabNavItem } from '@itsm/ui/shell';
import { cellWords, type PermissionView, type RoleMatrix } from './presentation.js';

export interface AccessViewProps {
  readonly tabs: readonly TabNavItem[];
  /** Null when roles cannot be read (the matrix and the role filter are left out). */
  readonly matrix: RoleMatrix | null;
  readonly rolesProblem?: Problem;
  readonly permissions: readonly PermissionView[];
  readonly permissionsProblem?: Problem;
  readonly areas: readonly { readonly value: string; readonly label: string }[];
}

const NOUN = { one: 'permission', other: 'permissions' } as const;

/**
 * Security › Access (SPEC §6.1 `/security/access`, B §3.15): who can do what.
 *
 * First the roles against the areas of the product — in each cell the most a
 * role may do there and how widely ("Work · their teams"), so the question
 * "what can a team lead do with rules?" is one glance. A role's heading
 * filters the registry below to what it grants.
 *
 * Then every permission the platform defines, grouped by area, named in
 * words with what it allows, the scopes it can be granted at and whether you
 * hold it. The technical key is a column for people who show keys. Nothing
 * here edits a role: custom roles are out of scope (§7.5).
 */
export function AccessView({ tabs, matrix, rolesProblem, permissions, permissionsProblem, areas }: AccessViewProps): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const registry = useRef<HTMLHeadingElement>(null);
  const selectedRole = params.get('role');

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'label', header: 'Permission', field: 'label', kind: 'title', secondaryField: 'description', minWidth: 260, width: '4fr' },
      { id: 'level', header: 'Kind', field: 'levelLabel', width: 96, minWidth: 90, hideBelow: 'sm' },
      { id: 'scopes', header: 'Can be granted for', field: 'scopes', minWidth: 170, width: '2fr', hideBelow: 'md' },
      { id: 'you', header: 'You', field: 'you', minWidth: 130, width: '1fr', empty: '—', cardRole: 'badge' },
      { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, minWidth: 200, hideBelow: 'lg' },
    ],
    [],
  );

  const filters = useMemo<FilterSpec[]>(
    () => [
      { id: 'area', label: 'Area', type: 'select', pinned: true, options: areas },
      { id: 'held', label: 'Held by me', type: 'boolean', pinned: true },
      ...(matrix ? [{ id: 'role', label: 'Role', type: 'select' as const, pinned: true, field: 'roles', options: matrix.roles.map((role) => ({ value: role.key, label: role.name })) }] : []),
    ],
    [areas, matrix],
  );

  /** A role's heading narrows the registry to it (the table reads `?role=` from the address) and takes the reader there. */
  const showRole = (key: string): void => {
    const next = new URLSearchParams(window.location.search);
    if (next.get('role') === key) next.delete('role');
    else next.set('role', key);
    const text = next.toString();
    window.history.replaceState(null, '', text ? `${window.location.pathname}?${text}` : window.location.pathname);
    registry.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="app-Page app-Security">
      <PageHeader title="Security" tabs={tabs} />

      {rolesProblem ? (
        <Card title="What each role can do" problem={rolesProblem} onRetry={() => router.refresh()} />
      ) : matrix ? (
        <Card title="What each role can do" subtitle="The most each role may do in each area, and for whose work. Choose a role to see its permissions." headerDivider>
          <div className="app-Matrix__scroll" tabIndex={0} role="region" aria-label="What each role can do, scrollable">
            <table className="app-Matrix">
              <caption className="itsm-visually-hidden">What each role can do in each area</caption>
              <thead>
                <tr>
                  <th scope="col" className="app-Matrix__corner">
                    Area
                  </th>
                  {matrix.roles.map((role) => (
                    <th key={role.key} scope="col" className="app-Matrix__role">
                      <button
                        type="button"
                        className="app-Matrix__roleButton"
                        aria-pressed={selectedRole === role.key}
                        onClick={() => showRole(role.key)}
                        title={role.description ?? undefined}
                      >
                        <span className="app-Matrix__roleName">{role.name}</span>
                        <span className="app-Matrix__roleCount">{role.count === 1 ? '1 permission' : `${role.count} permissions`}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.areas.map((area) => (
                  <tr key={area.id}>
                    <th scope="row" className="app-Matrix__area">
                      {area.label}
                    </th>
                    {matrix.roles.map((role) => {
                      const cell = matrix.cells[area.id]?.[role.key];
                      const words = cell ? cellWords(cell) : 'No access';
                      return (
                        <td key={role.key} className="app-Matrix__cell" data-level={cell?.level ?? 'none'} data-selected={selectedRole === role.key ? '' : undefined}>
                          {cell?.level ? (
                            <>
                              <Icon name={cell.level === 'manage' ? 'settings' : cell.level === 'work' ? 'pencil' : 'eye'} size="xs" className="app-Matrix__icon" />
                              <span>{words}</span>
                            </>
                          ) : (
                            <span className="app-Matrix__none">
                              <span aria-hidden="true">—</span>
                              <span className="itsm-visually-hidden">{words}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="app-Matrix__legend">
            <span>
              <Icon name="eye" size="xs" /> Read: can look
            </span>
            <span>
              <Icon name="pencil" size="xs" /> Work: does the desk’s work — raises, replies, assigns, decides
            </span>
            <span>
              <Icon name="settings" size="xs" /> Manage: changes how the desk behaves
            </span>
          </p>
        </Card>
      ) : null}

      <h2 ref={registry} className="app-Security__heading" tabIndex={-1}>
        Permissions
      </h2>
      <DataTable<PermissionView>
        caption="Permissions"
        captionHidden
        columns={columns}
        rows={permissions}
        rowKey="key"
        urlKey=""
        search={{ placeholder: 'Search permissions', mode: 'client', shortcut: '/' }}
        filters={filters}
        groupBy={{ field: 'area', label: (row) => row.areaLabel }}
        cells={{
          you: (row) =>
            row.you ? (
              <span className="app-Security__held">
                <Icon name="check" size="xs" />
                {row.you}
              </span>
            ) : (
              <span className="app-Security__quiet">
                <span aria-hidden="true">—</span>
                <span className="itsm-visually-hidden">Not held</span>
              </span>
            ),
        }}
        countNoun={NOUN}
        {...(permissionsProblem ? { problem: permissionsProblem, onRetry: () => router.refresh() } : {})}
        empty={{ title: 'No permissions declared', description: 'Every module declares the permissions it checks; none were returned.', icon: 'security' }}
        noResults={{ title: 'No permissions match', description: 'Try other words, another area, or clear the filters.' }}
      />
    </div>
  );
}
