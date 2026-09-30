import type { TabNavItem } from '@itsm/ui/shell';

/**
 * What the Integrations pages hand their client components: the header this
 * person sees, and plain rows with names resolved and secrets hidden
 * (SPEC §3.6, F8). The row shapes live beside their wording in
 * `presentation.ts`.
 */

export interface IntegrationsHeader {
  readonly tabs: readonly TabNavItem[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key?: string };
}

/** A webhook-eligible event, for the Add webhook sheet's picker. */
export interface EventChoice {
  readonly type: string;
  readonly description: string;
}
