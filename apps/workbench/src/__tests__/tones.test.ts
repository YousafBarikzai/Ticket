import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * D5 in the Service Desk (v3 §7.0.5, X-B3, V1-M3): amber means one thing.
 *
 * The only `warning` tones in `apps/workbench/src/**` are an SLA at risk, a
 * deadline close, and the offline and feedback notes (toasts, a failed
 * refresh, a session that ended). Everything else that was amber in v2 — a
 * waiting ticket, an internal note, a P2 — has its own look now: `hold` for
 * every wait, the neutral note frame, `high` for a P2.
 *
 * The test reads every source and stylesheet under `src/` (tests aside) and
 * finds each use of the warning tone: a `tone` set to `'warning'` in code, a
 * `data-tone="warning"`, or a `--itsm-colour-warning-*` variable in CSS. Each
 * hit must be on the kept list below, with the reason it stays; a new amber
 * anywhere else fails here, so it is converted or argued for in review. A
 * kept entry is matched against the hit's line and the three before it (a
 * CSS hit's rule starts above it), so a reason names the place, not a line
 * number that moves.
 */

interface Kept {
  /** The file, relative to `src/`, with forward slashes. */
  readonly file: string;
  /** Matched against the hit's line and the three lines before it. */
  readonly pattern: RegExp;
  readonly reason: string;
  /**
   * In a file another package owns and is changing (its work in progress):
   * the entry may stop matching when that package converts it, and that is
   * not a failure here.
   */
  readonly transient?: boolean;
}

const KEPT: readonly Kept[] = [
  /* SLA risk and deadlines: what amber is for. */
  { file: 'workspace/SlaBlock.tsx', pattern: /due_soon: \{ tone: 'warning'/, reason: 'SLA block: a running clock inside the hour (SLA risk)' },
  { file: 'app/(desk)/inbox/[view]/inbox.css', pattern: /\.app-TicketRow__due\[data-urgency='soon'\]/, reason: 'inbox row: a deadline due within the hour (SLA risk)' },

  /* Feedback notes: toasts and banners saying what just happened. */
  { file: 'workspace/TicketWorkspace.tsx', pattern: /notify\(/, reason: 'toasts: a state gate ("Needs a connection"), a conflict, a failed copy' },
  { file: 'workspace/inspector/Tasks.tsx', pattern: /notify\(/, reason: 'toast: a state gate on a task' },
  { file: 'workspace/inspector/Triage.tsx', pattern: /notify\(/, reason: 'toasts: a conflict on an accept or undo, Accept all stopping part-way, a failed copy' },
  { file: 'workspace/assist/Assist.tsx', pattern: /setFailure\(|notify\(|readonly tone: 'danger' \| 'warning'/, reason: 'Assist failures (nothing to ground on, budget reached, rate limited, slow) and a failed copy' },
  { file: 'inbox/TicketList.tsx', pattern: /notify\(|<Banner/, reason: 'a failed copy toast; the "Couldn’t refresh this list" banner', transient: true },
  { file: 'inbox/queries.ts', pattern: /bulkSummary|return \{ title|tone: result\.failed/, reason: 'the bulk action’s summary toast (nothing changed, part done)', transient: true },
  { file: 'components/DeskShell.tsx', pattern: /<GlobalBanner/, reason: 'the frame’s "Your session ended" notice' },

  /* Not converted in wave 3, each with its owner. */
  {
    file: 'inbox/TicketRow.tsx',
    pattern: /tone="warning" icon="pause"/,
    reason: 'v2 row’s waiting pill; WP-54 (wave 4) rewrites the row with ticketStateLook (hold)',
    transient: true,
  },
  {
    file: 'app/(desk)/inbox/[view]/inbox.css',
    pattern: /\.app-TicketRow__priority\[data-priority='P2'\]/,
    reason: 'v2 row’s P2 glyph; WP-54 (wave 4) replaces it with PriorityChip (high)',
    transient: true,
  },
  {
    file: 'app/globals.css',
    pattern: /\.app-Availability\[data-status='away'\]/,
    reason: 'availability "Away" dot: A7 m26 makes Away `hold`; globals.css has no wave-3 owner (reported to WP-53)',
    transient: true,
  },
];

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') sources(path, out);
    } else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const CODE_HIT = /\btone\b.*['"]warning['"]|data-tone=\{?['"]warning['"]/;
const CSS_HIT = /--itsm-colour-warning-|\[data-tone=['"]warning['"]\]/;

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  /** The line and the three before it. */
  readonly context: string;
}

function hits(): Hit[] {
  const found: Hit[] = [];
  for (const path of sources(SRC)) {
    const file = relative(SRC, path).split(sep).join('/');
    const lines = readFileSync(path, 'utf8').split('\n');
    const pattern = file.endsWith('.css') ? CSS_HIT : CODE_HIT;
    lines.forEach((text, index) => {
      if (!pattern.test(text)) return;
      if (/^\s*(\*|\/\/|\/\*)/.test(text)) return; // a comment explaining a tone is not a use of it
      found.push({ file, line: index + 1, text: text.trim(), context: lines.slice(Math.max(0, index - 3), index + 1).join('\n') });
    });
  }
  return found;
}

function keptFor(hit: Hit): Kept | undefined {
  return KEPT.find((entry) => entry.file === hit.file && entry.pattern.test(hit.context));
}

describe('D5: amber is an SLA at risk, a deadline close, or a feedback note', () => {
  const all = hits();

  it('finds the uses it guards (the scan works)', () => {
    expect(all.some((hit) => hit.file === 'workspace/SlaBlock.tsx')).toBe(true);
    expect(all.length).toBeGreaterThan(5);
  });

  it('has a kept reason for every warning tone in the Service Desk', () => {
    const unexplained = all.filter((hit) => !keptFor(hit)).map((hit) => `${hit.file}:${hit.line}  ${hit.text}`);
    expect(unexplained).toEqual([]);
  });

  it('keeps no stale entry for a file this wave converted', () => {
    const stale = KEPT.filter((entry) => !entry.transient && !all.some((hit) => hit.file === entry.file && entry.pattern.test(hit.context))).map(
      (entry) => `${entry.file}  ${entry.pattern}`,
    );
    expect(stale).toEqual([]);
  });

  it('gives every kept entry a reason', () => {
    for (const entry of KEPT) expect(entry.reason.length).toBeGreaterThan(10);
  });

  it('holds the converted places to their D5 looks', () => {
    const at = (file: string): string => readFileSync(join(SRC, file), 'utf8');
    // The internal note's frame is neutral (X-B3); the composer's note mode the same.
    expect(at('workspace/Conversation.tsx')).not.toMatch(/tone="warning"/);
    expect(at('workspace/Composer.tsx')).not.toMatch(/tone="warning"/);
    expect(at('app/(desk)/tickets/[id]/workspace.css')).not.toMatch(/colour-warning/);
    // A possible major incident is danger, not amber (A6 §5.6.3).
    expect(at('workspace/inspector/Triage.tsx')).toMatch(/<InlineAlert tone="danger" className="app-Triage__warning">/);
    // The waiting states read `hold` in the lists' presentation (WP-41's conversion).
    expect(at('inbox/presentation.ts')).toMatch(/case 'paused':\s*return 'hold';/);
  });
});
