import type { PersonRef } from '../PersonCell.js';

/**
 * What the rules pages hand their client views: plain, serialisable rows
 * (SPEC §3.6, no functions across the boundary).
 */

/** A rule as the list and the builder read it. */
export interface RuleView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly event: string;
  readonly conditions: unknown;
  readonly actions: readonly unknown[];
  readonly order: number;
  readonly mode: 'continue' | 'stop';
  /** The API's word: `draft`, `published`, `archived`. */
  readonly status: string;
  readonly version: number;
  /** Set once the rule has ever been published: a draft with it is a live rule taken offline by an edit (R1). */
  readonly publishedAt: string | null;
  readonly updatedAt: string;
}

/** The text a published version froze, as `publishRule` stores it. */
export interface RuleSnapshot {
  readonly key?: string;
  readonly name?: string;
  readonly event?: string;
  readonly conditions?: unknown;
  readonly actions?: readonly unknown[];
  readonly order?: number;
  readonly mode?: string;
}

export interface RuleVersionView {
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: PersonRef | null;
  readonly snapshot: RuleSnapshot;
}

/** Names for the ids and keys a rule refers to, so nothing prints raw. */
export interface RuleNames {
  /** Team id → name (A6); empty when the team list cannot be read. */
  readonly teams: Readonly<Record<string, string>>;
  /** Workflow key → name and whether it is published; empty when workflows cannot be read. */
  readonly workflows: Readonly<Record<string, { readonly name: string; readonly live: boolean }>>;
}

export interface Choice {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

/** What `?status=` scopes the list to. */
export type RuleScope = 'all' | 'live' | 'draft' | 'archived';

/** The state a rule is in, in the list's and the builder's words. */
export type RuleState = 'live' | 'draft' | 'changes' | 'archived';
