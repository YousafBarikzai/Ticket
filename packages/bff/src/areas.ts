/**
 * `@itsm/bff/areas` — the area model for one request, built on the server
 * (SPEC v3 §3.1; A2 §3.3).
 *
 * The one place in the three apps where the `*_ORIGIN` variables are read.
 * Every link that crosses from one area to another is built from what this
 * returns, through `crossAreaHref` in `@itsm/contracts/areas`, so a demo
 * session's links go through the sibling's `/demo` page and never straight to
 * a deep link a visitor's demo session cannot open.
 * `__tests__/no-raw-origins.test.ts` fails on any app file that reads an
 * origin itself.
 *
 * Each app wraps this in React's `cache()` as `currentAreas()` in its
 * `src/server/session.ts`, beside `currentMe()`, and hands the model — plain,
 * frozen, serialisable data — to its frame and pages.
 */
import {
  AREAS,
  AREA_ORDER,
  appOrigins,
  buildAreaModel,
  holdsArea,
  type AreaId,
  type AreaModel,
  type Origins,
} from '@itsm/contracts/areas';
import type { DemoPersonaKey } from '@itsm/contracts/demo';
import type { Environment } from './config.js';

export interface AreasForInput {
  readonly app: AreaId;
  /** The permission keys the person holds (`me.permissions`). */
  readonly held: Iterable<string>;
  /**
   * The BFF session, or null. Only `kind` and `persona` are read: a demo
   * session lists every area with its persona; anything else — including a
   * session record from before `kind` existed — is a real session.
   */
  readonly session: { readonly kind?: 'oidc' | 'dev' | 'demo'; readonly persona?: DemoPersonaKey } | null;
  /** The tenant's display name for the switcher's header. */
  readonly workspace?: string;
  /** The current area's home when it is not `AREAS[app].home`. */
  readonly homePath?: string;
  /** Demo only: the Service Desk persona's teams, from `/me.demo`. */
  readonly agentTeamIds?: readonly string[];
  /** Defaults to `process.env`, read once per process. */
  readonly env?: Environment;
}

let processOrigins: Origins | undefined;

/**
 * The deployment's origins. `process.env` is read once per process: the
 * origins are deployment configuration, fixed for the process's life, and a
 * layout that renders on every request should not re-parse four URLs each
 * time. An explicit `env` (a test, a script) is read on every call.
 */
function originsFrom(env: Environment | undefined): Origins {
  if (env) return appOrigins(env);
  processOrigins ??= appOrigins(process.env);
  return processOrigins;
}

const reported = new Set<string>();

/**
 * Once per process and variable, say which row a misconfigured deployment
 * lost. The row is left out rather than linked to nowhere, so without this
 * line the only symptom would be a switcher with one area fewer than expected.
 */
function reportMissingOrigins(input: AreasForInput, origins: Origins, env: Environment): void {
  const demo = input.session?.kind === 'demo';
  const held = input.held instanceof Set ? (input.held as ReadonlySet<string>) : new Set(input.held);
  for (const id of AREA_ORDER) {
    if (id === input.app || origins[id] || reported.has(id)) continue;
    if (!demo && !holdsArea(id, held)) continue;
    reported.add(id);
    const { originEnv, name } = AREAS[id];
    const problem = env[originEnv]?.trim() ? 'is not an http(s) URL' : 'is not set';
    console.warn(`[bff] areas: ${originEnv} ${problem}; ${name} left out of the switcher`);
  }
}

/** The area model for this person in this app. */
export function areasFor(input: AreasForInput): AreaModel {
  const env = input.env ?? process.env;
  const origins = originsFrom(input.env);
  // The held keys are read twice (here and in the model), so an iterator that
  // can only be walked once is collected first.
  const held = input.held instanceof Set ? input.held : [...input.held];
  reportMissingOrigins({ ...input, held }, origins, env);
  const kind = input.session?.kind === 'demo' ? 'demo' : input.session?.kind === 'dev' ? 'dev' : 'oidc';
  return buildAreaModel({
    app: input.app,
    held,
    session: { kind, ...(kind === 'demo' && input.session?.persona ? { persona: input.session.persona } : {}) },
    origins,
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.homePath ? { homePath: input.homePath } : {}),
    ...(input.agentTeamIds ? { agentTeamIds: input.agentTeamIds } : {}),
  });
}
