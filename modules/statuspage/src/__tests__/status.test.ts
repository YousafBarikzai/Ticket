import { describe, expect, it } from 'vitest';
import {
  componentStatusForImpact,
  impactForSeverity,
  incidentStatusFor,
  maintenanceStatusAt,
  overallStatus,
  worstOf,
} from '../domain/status.js';

describe('what the public hears about a severity', () => {
  it('maps the three severities down to the three impacts', () => {
    expect(impactForSeverity('SEV1')).toBe('critical');
    expect(impactForSeverity('SEV2')).toBe('major');
    expect(impactForSeverity('SEV3')).toBe('minor');
  });

  it('understates a severity it does not know rather than overstating it', () => {
    expect(impactForSeverity('SEV0')).toBe('minor');
    expect(impactForSeverity('')).toBe('minor');
  });

  it('is not case-sensitive, because the desk types it either way', () => {
    expect(impactForSeverity('sev1')).toBe('critical');
  });
});

describe('what an impact does to a component', () => {
  it('marks the component in proportion', () => {
    expect(componentStatusForImpact('critical')).toBe('major_outage');
    expect(componentStatusForImpact('major')).toBe('partial_outage');
    expect(componentStatusForImpact('minor')).toBe('degraded');
  });

  it('leaves the component alone for an incident with no impact', () => {
    expect(componentStatusForImpact('none')).toBe('operational');
  });
});

describe('what the public hears about a bridge state', () => {
  it('folds the internal lifecycle into four words', () => {
    expect(incidentStatusFor('declared')).toBe('investigating');
    expect(incidentStatusFor('investigating')).toBe('investigating');
    expect(incidentStatusFor('identified')).toBe('identified');
    expect(incidentStatusFor('mitigating')).toBe('identified');
    expect(incidentStatusFor('monitoring')).toBe('monitoring');
    expect(incidentStatusFor('resolved')).toBe('resolved');
    expect(incidentStatusFor('stood_down')).toBe('resolved');
    expect(incidentStatusFor('closed')).toBe('resolved');
  });

  it('says nothing for a state it was not designed to explain', () => {
    // An update with no status change, or a state added to MOD-08 later,
    // leaves the page's incident where it is rather than guessing.
    expect(incidentStatusFor(null)).toBeNull();
    expect(incidentStatusFor('escalated')).toBeNull();
  });
});

describe('the worst of what touches a component', () => {
  it('is operational when nothing does', () => {
    expect(worstOf([])).toBe('operational');
  });

  it('is the worst, whatever the order', () => {
    expect(worstOf(['degraded', 'major_outage', 'partial_outage'])).toBe('major_outage');
    expect(worstOf(['major_outage', 'degraded'])).toBe('major_outage');
  });

  it('shows maintenance only when nothing is actually broken', () => {
    expect(worstOf(['maintenance'])).toBe('maintenance');
    expect(worstOf(['maintenance', 'degraded'])).toBe('degraded');
    expect(worstOf(['maintenance', 'operational'])).toBe('maintenance');
  });

  it('gives the page the worst of its visible components and ignores the hidden ones', () => {
    expect(
      overallStatus([
        { status: 'operational', isVisible: true },
        { status: 'degraded', isVisible: true },
        { status: 'major_outage', isVisible: false },
      ]),
    ).toBe('degraded');
    expect(overallStatus([])).toBe('operational');
  });
});

describe('a maintenance window by the clock', () => {
  const window = { startsAt: new Date('2026-09-20T02:00:00Z'), endsAt: new Date('2026-09-20T04:00:00Z'), status: 'scheduled' as const };

  it('is scheduled before it starts, in progress during, completed after', () => {
    expect(maintenanceStatusAt(window, new Date('2026-09-20T01:59:59Z'))).toBe('scheduled');
    expect(maintenanceStatusAt(window, new Date('2026-09-20T02:00:00Z'))).toBe('in_progress');
    expect(maintenanceStatusAt(window, new Date('2026-09-20T03:59:59Z'))).toBe('in_progress');
    expect(maintenanceStatusAt(window, new Date('2026-09-20T04:00:00Z'))).toBe('completed');
  });

  it('never revives a window somebody cancelled or closed early', () => {
    // The sweep runs every five minutes over every window; if the clock could
    // reopen a cancelled one it would do so five minutes after the operator
    // cancelled it.
    expect(maintenanceStatusAt({ ...window, status: 'cancelled' }, new Date('2026-09-20T03:00:00Z'))).toBe('cancelled');
    expect(maintenanceStatusAt({ ...window, status: 'completed' }, new Date('2026-09-20T03:00:00Z'))).toBe('completed');
  });
});
