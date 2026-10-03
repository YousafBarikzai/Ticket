import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TICKET_STATE_LOOK } from '@itsm/ui';
import { PRIORITY_LOOK as CATALOGUE_PRIORITY_LOOK, FORM_STATE_LOOK, REQUEST_STATE_LOOK } from '../components/catalogue/presentation.js';
import { CI_STATUS_LOOK, CRITICALITY_LOOK, ASSET_STATUS_LOOK } from '../components/cmdb/presentation.js';
import { OUTCOME_LOOK } from '../components/ai-triage/decisions.js';
import { STATUS_LOOK as TENANT_LOOK } from '../components/platform/presentation.js';
import { RULE_STATES } from '../components/rules/presentation.js';
import { SEVERITY_LOOK } from '../components/security/presentation.js';
import { policyState } from '../components/sla/presentation.js';
import { PRIORITY_LOOK, statusLook } from '../components/tickets/presentation.js';
import { workflowLook } from '../components/workflows/presentation.js';
import { STATUS_LOOK as AVAILABILITY_LOOK } from '../components/workforce/presentation.js';
import { LIFECYCLE } from '../lifecycle.js';
import { TICKET_STATUSES } from '../rules/facts.js';

/**
 * D5 in Administration (A7 §2.9; SPEC §7.0.5): amber means **SLA risk or due
 * soon**, and nothing else. A ticket status, a P2, a degraded CI, a busy
 * agent, a suspended tenant or a draft with unpublished changes each has a
 * colour of its own; amber on any of them would tell an administrator a
 * clock is running out when none is.
 *
 * The grep below reads every `'warning'` in `apps/admin/src` (tests aside).
 * A hit is allowed when it is:
 *
 *   - **feedback**, not status: a toast (`notify(`) or a banner, inline alert
 *     or global banner (`<Banner`, `<InlineAlert`, `<GlobalBanner`) — those
 *     say "this went partly wrong" or "you're offline", which is what the
 *     warning tone is for;
 *   - or on the **kept list**, by file and the text of the line, with the
 *     reason it stays: due soon, a threshold approaching, an SLA risk, a
 *     builder's validation note, or a pairing another wave converts together.
 *
 * Every other hit fails, and so does a kept entry that no longer matches
 * anything, so the list cannot rot.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

interface Kept {
  readonly file: string;
  readonly pattern: string;
  readonly reason: string;
}

const KEPT: readonly Kept[] = [
  // Due soon.
  { file: 'components/cmdb/presentation.ts', pattern: "return { label, tone: 'warning', icon: 'clock' }", reason: 'warranty ends soon: due soon' },
  { file: 'components/cmdb/AssetsView.tsx', pattern: "('danger' as const) : ('warning' as const)", reason: 'the warranty window filter: expired is danger, ending soon is due soon' },
  { file: 'components/integrations/presentation.ts', pattern: "state: 'soon', days", reason: 'credential expires soon: due soon' },
  { file: 'components/integrations/presentation.ts', pattern: "if (expiry.state === 'soon') return", reason: 'credential expires soon: due soon' },
  { file: 'components/integrations/presentation.ts', pattern: "if (expiry?.state === 'soon') return", reason: 'an action’s credential expires soon: due soon' },
  { file: 'app/(console)/(admin)/integrations/page.tsx', pattern: "action.health.tone === 'warning'", reason: 'counts actions whose health is the due-soon or re-encrypt tone above' },
  // A threshold approaching is "due soon" for a budget or a plan.
  { file: 'components/ai-triage/BudgetCard.tsx', pattern: "warned: { tone: 'warning'", reason: 'past the AI budget’s warning line: a threshold approaching' },
  { file: 'components/settings/UsageView.tsx', pattern: "warned: { tone: 'warning'", reason: 'past a plan meter’s warning line: a threshold approaching' },
  { file: 'components/platform/TenantDrawer.tsx', pattern: "'Past the warning line'", reason: 'a tenant’s meter past its warning line: a threshold approaching' },
  // Needs attention: severities, where amber is an SLA risk or something due soon (A7 §4.1).
  { file: 'server/needs-attention.ts', pattern: "export type AttentionTone = 'danger' | 'warning' | 'info'", reason: 'the attention severities' },
  { file: 'server/needs-attention.ts', pattern: "ticket.priority === 'P1') ? 'danger' : 'warning'", reason: 'urgent unowned tickets; WP-55 narrows amber to due within 4 h' },
  { file: 'server/needs-attention.ts', pattern: "tone: overdue > 0 ? 'danger' : 'warning'", reason: 'SLA risk' },
  { file: 'server/needs-attention.ts', pattern: "tone: critical ? 'danger' : 'warning'", reason: 'security alerts; WP-55 re-tones the attention list (A7 §4.1)' },
  { file: 'server/needs-attention.ts', pattern: "soon.length > 0 ? 'warning' : 'info'", reason: 'credentials expiring: due soon' },
  { file: 'server/needs-attention.ts', pattern: "tone: blocked ? 'danger' : 'warning'", reason: 'a meter near its limit: a threshold approaching' },
  { file: 'server/needs-attention.ts', pattern: "tone: budget.state === 'blocked' ? 'danger' : 'warning'", reason: 'the AI budget near its limit: a threshold approaching' },
  { file: 'components/command-centre/presentation.ts', pattern: "readonly items: readonly { readonly tone: 'danger' | 'warning' | 'info' }[]", reason: 'reads the attention severities' },
  // Feedback that is not a toast or a banner element.
  { file: 'components/integrations/presentation.ts', pattern: "readonly tone: 'success' | 'warning' | 'danger' } {", reason: 'a bulk replay or dismiss result, shown as a toast' },
  { file: 'components/integrations/presentation.ts', pattern: "? 'warning' : 'success';", reason: 'a bulk replay or dismiss result, shown as a toast' },
  { file: 'components/audit/presentation.ts', pattern: "readonly state: 'ok' | 'warning';", reason: 'the sequence check: a note printed under the list, not a status' },
  { file: 'components/audit/presentation.ts', pattern: "return { state: 'warning', text:", reason: 'the sequence check: a note printed under the list, not a status' },
  { file: 'app/(console)/(admin)/ai-triage/page.tsx', pattern: "tone: 'warning' | 'info'", reason: 'the page banner’s tone (feedback)' },
  { file: 'app/(console)/(admin)/ai-triage/page.tsx', pattern: "? { tone: 'warning', title:", reason: 'the page banner: AI is off, or stepped back (feedback)' },
  // A builder's own validation notes.
  { file: 'components/catalogue/QuestionsEditor.tsx', pattern: "tone?: 'warning' | 'neutral' | 'danger'", reason: 'a question’s check chips in the form builder (validation)' },
  { file: 'components/catalogue/OptionsEditor.tsx', pattern: "? 'danger' : 'warning'", reason: 'an option list’s check note in the form builder (validation)' },
  { file: 'components/workflows/StepsOutline.tsx', pattern: '<Badge size="sm" tone="warning">', reason: 'a step the definition never reaches: the builder’s check (validation)' },
  // Converted together in wave 6 by WP-79, which owns both halves: the pill in the view paints the same state.
  { file: 'components/integrations/presentation.ts', pattern: "attempts >= ATTEMPTS_WARNING ? 'warning' : 'neutral'", reason: 'retry count; DeliveriesView.tsx compares it and paints its own pill (WP-79 → high)' },
  { file: 'components/integrations/DeliveriesView.tsx', pattern: "attemptsTone(row.attempts) === 'warning'", reason: 'retry count (WP-79 → high)' },
  { file: 'components/integrations/DeliveriesView.tsx', pattern: '<StatusPill size="sm" tone="warning" icon="refresh-cw"', reason: 'retry count (WP-79 → high)' },
  { file: 'components/integrations/presentation.ts', pattern: "credential.needsRewrap) return { label: 'Needs re-encrypting', tone: 'warning'", reason: 'needs re-encrypting; CredentialsView.tsx paints the same state (WP-79 → high)' },
  { file: 'components/integrations/presentation.ts', pattern: "credential?.needsRewrap) return { label: 'Credential needs re-encrypting', tone: 'warning'", reason: 'needs re-encrypting (WP-79 → high)' },
  { file: 'components/integrations/CredentialsView.tsx', pattern: 'tone="warning" icon="key" label="Needs re-encrypting"', reason: 'needs re-encrypting (WP-79 → high)' },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  /** The line and the three before it: a multi-line `notify(` or `<Banner` opens there. */
  readonly window: string;
}

const WARNING = /(['"`])warning\1/;
const FEEDBACK = /\bnotify\(|<(?:InlineAlert|Banner|GlobalBanner)\b/;

const hits: Hit[] = sources(SRC).flatMap((path) => {
  const file = relative(SRC, path).split(sep).join('/');
  const lines = readFileSync(path, 'utf8').split('\n');
  return lines.flatMap((text, index) => {
    if (!WARNING.test(text)) return [];
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return [];
    return [{ file, line: index + 1, text, window: lines.slice(Math.max(0, index - 3), index + 1).join('\n') }];
  });
});

const isKept = (hit: Hit): Kept | undefined => KEPT.find((entry) => entry.file === hit.file && hit.text.includes(entry.pattern));

describe('amber means SLA risk or due soon (D5)', () => {
  it('finds the console’s warning tones', () => {
    expect(hits.length).toBeGreaterThan(20);
  });

  it('allows a warning only as feedback or on the kept list', () => {
    const offenders = hits.filter((hit) => !FEEDBACK.test(hit.window) && !isKept(hit)).map((hit) => `${hit.file}:${hit.line}: ${hit.text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('keeps no entry that matches nothing, and gives every entry a reason', () => {
    for (const entry of KEPT) {
      expect(entry.reason.length, entry.pattern).toBeGreaterThan(5);
      expect(
        hits.some((hit) => hit.file === entry.file && hit.text.includes(entry.pattern)),
        `${entry.file}: ${entry.pattern}`,
      ).toBe(true);
    }
  });

  it('never puts a P2 in amber, anywhere', () => {
    expect(hits.filter((hit) => /\bP2\b/.test(hit.text)).map((hit) => `${hit.file}:${hit.line}`)).toEqual([]);
    expect(PRIORITY_LOOK.P2?.tone).toBe('high');
    expect(CATALOGUE_PRIORITY_LOOK.P2).toEqual({ label: 'P2 · High', tone: 'high' });
    expect(Object.values(PRIORITY_LOOK).map((look) => look.tone)).toEqual(['danger', 'high', 'neutral', 'neutral']);
  });

  it('never puts a ticket status in amber', () => {
    for (const status of [...TICKET_STATUSES.map((entry) => entry.value), ...Object.keys(TICKET_STATE_LOOK)]) {
      for (const category of ['open', 'paused', 'resolved', 'closed', null]) {
        expect(statusLook(status, category).tone, `${status}/${category}`).not.toBe('warning');
      }
    }
    expect(statusLook('pending_requester', 'paused')).toMatchObject({ label: 'Waiting on requester', tone: 'hold' });
    expect(statusLook('awaiting_parts', 'paused')).toMatchObject({ label: 'Awaiting parts', tone: 'hold' });
  });
});

describe('the converted looks (A7 §2.9)', () => {
  it('reads paused things as hold', () => {
    expect(TENANT_LOOK.suspended?.tone).toBe('hold');
    expect(ASSET_STATUS_LOOK.in_repair?.tone).toBe('hold');
    expect(LIFECYCLE.waiting).toEqual({ label: 'Waiting', tone: 'hold', icon: 'hourglass' });
    expect(AVAILABILITY_LOOK.away?.tone).toBe('hold');
  });

  it('reads work in progress as info', () => {
    expect(LIFECYCLE.changed?.tone).toBe('info');
    expect(RULE_STATES.changes.tone).toBe('info');
    expect(FORM_STATE_LOOK.changes.tone).toBe('info');
    expect(REQUEST_STATE_LOOK.changes.tone).toBe('info');
    expect(workflowLook({ status: 'published', liveVersion: 3, hasDraft: true })).toMatchObject({ label: 'Unpublished changes', tone: 'info' });
  });

  it('reads degraded and high criticality as high, and busy as neutral with its own glyph (X-m26)', () => {
    expect(CI_STATUS_LOOK.degraded?.tone).toBe('high');
    expect(CRITICALITY_LOOK.high?.tone).toBe('high');
    expect(AVAILABILITY_LOOK.busy).toEqual({ label: 'Busy', tone: 'neutral', icon: 'minus-circle' });
  });

  it('tells security severities apart by tone and glyph: critical red, high orange, medium and low neutral', () => {
    expect([SEVERITY_LOOK.critical.tone, SEVERITY_LOOK.high.tone, SEVERITY_LOOK.medium.tone, SEVERITY_LOOK.low.tone]).toEqual(['danger', 'high', 'neutral', 'neutral']);
    expect(new Set(Object.values(SEVERITY_LOOK).map((look) => look.icon)).size).toBe(4);
  });

  it('reads an unanswered suggestion, an unknown policy state and an open alert without amber', () => {
    expect(OUTCOME_LOOK.none?.tone).toBe('neutral');
    expect(policyState('paused')).toEqual({ label: 'Paused', tone: 'neutral' });
    expect(LIFECYCLE.open?.tone).toBe('high');
  });
});
