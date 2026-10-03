import type { Client } from '../client.js';
import type { OnCallRow, RotationRow } from './operations.js';

/**
 * Service management reads that the Service Desk and Administration share:
 * major incidents and who is on call.
 *
 * Both areas carry the major-incident chip in their frame, and both put
 * "On call now" on their home page; written once here so the two cannot
 * drift into two spellings of one request. `workbench()` and `operations()`
 * each re-expose these under their own names. This file grows with the
 * desk's other shared records — changes, problems, knowledge authoring —
 * as the pages that need them arrive.
 *
 * Types only from `operations.ts`, never values: the Service Desk's browser
 * client imports this file, and the console's surface must not come with it.
 */

export interface MajorIncidentRow {
  number: string;
  title: string;
  severity: string;
  status: string;
  commanderId: string | null;
  customerFacing: boolean;
  declaredAt: string;
  resolvedAt: string | null;
  nextUpdateDueAt: string | null;
}

export interface MajorIncidentFilter {
  /** `true` for the ones still running, which is what a chip or a banner wants; `false` for closed ones only. */
  open?: boolean;
  status?: string;
  severity?: string;
}

/** Who a timeline entry was written for. `internal` sees everything; the others see what was published to them. */
export type MajorIncidentAudience = 'internal' | 'stakeholders' | 'public';

/** One line of an incident's timeline. */
export interface MajorIncidentTimelineEntry {
  id: string;
  kind: string;
  audience: string;
  body: string;
  statusFrom: string | null;
  statusTo: string | null;
  authorId: string | null;
  occurredAt: string;
}

/**
 * The incident room's read (`GET /major-incidents/:number`): the incident,
 * its timeline for the audience asked about, and its review.
 *
 * `ticketId` is how a page reaches the incident's ticket — the frame's chip
 * links there until the Service Desk's major-incident pages ship.
 */
export interface MajorIncidentDetail {
  number: string;
  title: string;
  severity: string;
  status: string;
  impactSummary: string | null;
  affectedServiceIds: string[];
  customerFacing: boolean;
  bridgeUrl: string | null;
  ticketId: string | null;
  roles: { commanderId: string; commsLeadId: string | null; scribeId: string | null };
  updateIntervalMinutes: number;
  nextUpdateDueAt: string | null;
  declaredAt: string;
  identifiedAt: string | null;
  mitigatedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  timeline: MajorIncidentTimelineEntry[];
  /** `dueOn` is a date, `YYYY-MM-DD`. Null until a review is opened. */
  review: { status: string; dueOn: string | null; publishedAt: string | null } | null;
}

export interface MajorIncidents {
  /** Needs `incident.major.read`; everybody who works the desk holds it. */
  majorIncidents(filter?: MajorIncidentFilter): Promise<MajorIncidentRow[]>;
  /** One incident by number (`MI-0004`); `audience` filters the timeline, `internal` by default. */
  majorIncident(number: string, audience?: MajorIncidentAudience): Promise<MajorIncidentDetail>;
}

export interface OnCall {
  /** A team's rotations, or every rotation the reader may see. */
  rotations(teamId?: string): Promise<RotationRow[]>;
  /** Who is on call for one rotation, now or at `at` (an ISO instant), and the next few handovers. */
  onCall(rotationKey: string, at?: string): Promise<OnCallRow>;
}

const unwrap = <T>(body: { data: T }): T => body.data;

export function majorIncidentsApi(client: Client): MajorIncidents {
  return {
    // `open` is sent as a word either way. It is the one boolean filter whose
    // `false` means something — closed ones only — rather than "no filter",
    // so it cannot go through the rule that drops `false` from a query.
    majorIncidents: (filter = {}) =>
      client
        .request<{ data: MajorIncidentRow[] }>('/api/v1/major-incidents', {
          query: {
            open: filter.open === undefined ? undefined : String(filter.open),
            status: filter.status,
            severity: filter.severity,
          },
        })
        .then(unwrap),
    majorIncident: (number, audience) =>
      client.request<MajorIncidentDetail>(`/api/v1/major-incidents/${encodeURIComponent(number)}`, { query: { audience } }),
  };
}

export function onCallApi(client: Client): OnCall {
  return {
    rotations: (teamId) =>
      client.request<{ data: RotationRow[] }>('/api/v1/workload/rotations', { query: { teamId } }).then(unwrap),
    onCall: (rotationKey, at) =>
      client.request<OnCallRow>(`/api/v1/workload/rotations/${encodeURIComponent(rotationKey)}/on-call`, { query: { at } }),
  };
}
