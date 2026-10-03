import type { SettingType } from '@itsm/sdk';
import type { FlagGroupId, SettingGroupId } from '../../settings/catalogue.js';

/**
 * The rows the Settings pages hand their client views: plain JSON, with
 * everything a row says already in words (SPEC §3.6 rule 3 — no functions
 * cross from server to client).
 */

export interface SettingItem {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: SettingGroupId;
  readonly type: SettingType;
  readonly value: unknown;
  readonly default: unknown;
  /** The value differs from the module's default. */
  readonly changed: boolean;
  /** "Changed by Alex Administrator · 3 Sept 2026", only when changed. */
  readonly note: string | null;
  /** Set for one of the person's organisations: shown, not changed here. */
  readonly locked: boolean;
}

export interface FlagItem {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: FlagGroupId;
  /** What the tenant gets: its own value, or the default (A1). */
  readonly value: boolean;
  readonly default: boolean;
  readonly owner: string;
  /** "Temporary · review by phase 3"; null for a permanent flag. */
  readonly expiry: string | null;
  readonly changed: boolean;
}

export interface SettingsSearchState {
  readonly query: string;
  readonly changedOnly: boolean;
}

/** Where AI triage is, in words, for the AI tab's Triage card. */
export interface TriageSummary {
  /** "Suggest", or "Off" with the reason. */
  readonly label: string;
  readonly sentence: string;
  readonly tone: 'neutral' | 'info' | 'success';
  readonly href?: string;
}
