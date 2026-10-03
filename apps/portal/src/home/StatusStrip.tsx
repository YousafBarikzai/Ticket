import type { ReactNode } from 'react';
import { Banner, Icon } from '@itsm/ui';
import type { KnownIssue } from '../help/model.js';
import type { StatusSummary } from './model.js';

/**
 * The service status, in one strip under the hero (v3 §7.2, A6 §6.1.2):
 *
 *   - **an open incident** — "VPN partial outage. We're on it. · Affects
 *     Network & VPN · Updated 10:42 · Follow updates", toned through the
 *     one component-state map (degraded `high`, an outage `danger`), so
 *     nobody reports what the desk already knows;
 *   - **something not running without an incident** — the overall state and
 *     what is affected, in the same tones;
 *   - **all running** — one calm line, "All services running · checked
 *     10:42", with the way to the status page;
 *   - **the status could not be read** — said honestly, never as all well;
 *   - **no status page** — nothing.
 *
 * News, not an interruption: a status region, not an alert. Server-drawn;
 * `Banner` is the design system's.
 */

export interface StatusStripProps {
  readonly issues: readonly KnownIssue[];
  /** The tone of the worst affected component (`incidentTone`). */
  readonly issueTone: 'high' | 'danger';
  readonly summary: StatusSummary | null;
  /** The status page could not be read just now. */
  readonly failed: boolean;
  /** The public status page, for "Follow updates" and "View status". */
  readonly followUrl: string | null;
  /** "10:42": when the first issue was last updated. */
  readonly updatedLabel: string | null;
  /** "10:42": when this page read the status. */
  readonly checkedLabel: string;
}

function sentence(title: string): string {
  return `${title.replace(/[\s.!?]+$/, '')}.`;
}

export function StatusStrip({ issues, issueTone, summary, failed, followUrl, updatedLabel, checkedLabel }: StatusStripProps): ReactNode {
  const [first] = issues;
  const follow = followUrl ? { id: 'follow', label: 'Follow updates', href: followUrl, external: true, variant: 'secondary' as const } : null;

  if (first) {
    const more = issues.length - 1;
    return (
      <Banner tone={issueTone} className="app-StatusStrip" live={false} title={`${sentence(first.title)} We’re on it.`} {...(follow ? { action: follow } : {})}>
        {first.components.length > 0 ? `Affects ${first.components.join(', ')} · ` : ''}Updated {updatedLabel ?? checkedLabel}
        {more > 0 ? ` · ${more} more open ${more === 1 ? 'issue' : 'issues'}` : ''}
      </Banner>
    );
  }

  if (summary && summary.overall.tone !== 'success') {
    return (
      <Banner
        tone={summary.overall.tone}
        icon={summary.overall.icon}
        className="app-StatusStrip"
        live={false}
        title={summary.overall.label}
        {...(follow ? { action: { ...follow, label: 'View status' } } : {})}
      >
        {summary.components.length > 0 ? `${summary.components.map((component) => `${component.name}: ${component.state.label.toLocaleLowerCase('en-GB')}`).join(' · ')} · ` : ''}Checked {checkedLabel}
      </Banner>
    );
  }

  if (summary) {
    return (
      <Banner
        tone="success"
        variant="subtle"
        className="app-StatusStrip"
        live={false}
        title="All services running"
        {...(followUrl ? { action: { id: 'status', label: 'View status', href: followUrl, external: true, variant: 'ghost' as const } } : {})}
      >
        Checked {checkedLabel}
      </Banner>
    );
  }

  if (failed) {
    return (
      <p className="app-StatusStrip app-StatusStrip--quiet">
        <Icon name="cloud-off" size="sm" /> Couldn’t check service status just now.
      </p>
    );
  }
  return null;
}
