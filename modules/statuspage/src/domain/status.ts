/**
 * The vocabulary of a status page, and how the desk's own words map onto it.
 *
 * A public page has a small, fixed set of things to say, and they are not the
 * same words the incident commander uses. "Mitigating" is a fact about the
 * bridge; the public wants to know whether it has been identified and whether
 * it is being watched. The mappings are here so the page never shows an
 * internal state it was not designed to explain.
 */

export const COMPONENT_STATUSES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const IMPACTS = ['none', 'minor', 'major', 'critical'] as const;
export type Impact = (typeof IMPACTS)[number];

export const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

/** A major incident's severity, as the public should hear it. */
export function impactForSeverity(severity: string): Impact {
  switch (severity.toUpperCase()) {
    case 'SEV1':
      return 'critical';
    case 'SEV2':
      return 'major';
    case 'SEV3':
      return 'minor';
    default:
      return 'minor';
  }
}

/** What an impact does to the components it touches. */
export function componentStatusForImpact(impact: Impact): ComponentStatus {
  switch (impact) {
    case 'critical':
      return 'major_outage';
    case 'major':
      return 'partial_outage';
    case 'minor':
      return 'degraded';
    case 'none':
      return 'operational';
  }
}

/**
 * A MOD-08 status, as the public should hear it. Unknown states keep the
 * incident where it is: the page never guesses.
 */
export function incidentStatusFor(majorIncidentStatus: string | null): IncidentStatus | null {
  switch (majorIncidentStatus) {
    case 'declared':
    case 'investigating':
      return 'investigating';
    case 'identified':
    case 'mitigating':
      return 'identified';
    case 'monitoring':
      return 'monitoring';
    case 'resolved':
    case 'stood_down':
    case 'closed':
      return 'resolved';
    default:
      return null;
  }
}

const RANK: Record<ComponentStatus, number> = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };

/**
 * The status a component should show given everything touching it right now.
 * The worst wins; maintenance shows only when nothing is actually broken.
 */
export function worstOf(statuses: ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>((worst, status) => (RANK[status] > RANK[worst] ? status : worst), 'operational');
}

/** The headline for the whole page: the worst of its visible components. */
export function overallStatus(components: { status: ComponentStatus; isVisible: boolean }[]): ComponentStatus {
  return worstOf(components.filter((component) => component.isVisible).map((component) => component.status));
}

export const STATUS_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  maintenance: 'Under maintenance',
};

export const HEADLINES: Record<ComponentStatus, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems are degraded',
  partial_outage: 'Some systems are experiencing an outage',
  major_outage: 'A major outage is in progress',
  maintenance: 'Maintenance in progress',
};

/** Whether a maintenance window is live at an instant. */
export function maintenanceStatusAt(window: { startsAt: Date; endsAt: Date; status: MaintenanceStatus }, now: Date): MaintenanceStatus {
  if (window.status === 'cancelled' || window.status === 'completed') return window.status;
  if (now >= window.endsAt) return 'completed';
  if (now >= window.startsAt) return 'in_progress';
  return 'scheduled';
}
