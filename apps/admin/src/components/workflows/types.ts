import type { FlowGraph } from './graph.js';

/**
 * What the workflow pages hand their client views: plain, serialisable
 * rows (SPEC §3.6).
 */

export interface WorkflowView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  /** `draft` or `published`. */
  readonly status: string;
  readonly updatedAt: string;
  /** The version runs start on, or null when none is published. */
  readonly liveVersion: number | null;
  /** A newer draft waits on top of what is live (or nothing is live yet). */
  readonly hasDraft: boolean;
  /** How a run starts, in words; null when the graph could not be read. */
  readonly trigger: string | null;
}

export interface VersionView {
  readonly version: number;
  /** `draft` or `published`. */
  readonly status: string;
  readonly changeNote: string | null;
  readonly publishedAt: string | null;
  readonly isCurrent: boolean;
}

export interface RunView {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowKey: string | null;
  readonly workflowName: string;
  readonly ticketId: string | null;
  /** `queued`, `running`, `waiting`, `failed`, `completed`, `cancelled`. */
  readonly status: string;
  readonly currentKeys: readonly string[];
  /** The current step's name, from the graph; null when there is none or it is not known. */
  readonly stepTitle: string | null;
  readonly error: string | null;
  readonly triggeredBy: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** The graphs the runs on a page belong to, by workflow key, for step names and the drawer's diagram. */
export type GraphsByKey = Readonly<Record<string, FlowGraph>>;

export type RunScope = 'all' | 'failed' | 'waiting' | 'running' | 'completed' | 'cancelled';
