import type { TabNavItem } from '@itsm/ui/shell';

/**
 * What the People pages hand their client components (SPEC §3.6): plain,
 * serialisable values with names resolved on the server. Row shapes live
 * beside their wording in `presentation.ts`.
 */

export interface PeopleHeader {
  readonly tabs: readonly TabNavItem[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key?: string };
}

/** What the signed-in person may do here, worked out once on the server. */
export interface PeopleAbilities {
  /** `identity.user.manage`: add, deactivate, reactivate. */
  readonly manage: boolean;
  /** `identity.role.read`: see a person's roles. */
  readonly readRoles: boolean;
  /** `identity.role.manage`: give and take away roles. */
  readonly grant: boolean;
  /** `identity.org.manage`: create teams, add people to them. */
  readonly manageTeams: boolean;
  /** `tenant.org.manage`: create organisations (the API's gate for it). */
  readonly manageOrganisations: boolean;
  /** `workload.read`/`manage`: see someone's availability. */
  readonly readAvailability: boolean;
}

/** A choice for a select, by name. */
export interface NamedOption {
  readonly value: string;
  readonly label: string;
}

/** A team, by name, with its organisation: for "Add to team" and team-scoped roles. */
export interface TeamOption {
  readonly id: string;
  readonly name: string;
  readonly orgId: string;
}
