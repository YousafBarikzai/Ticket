import type { Entity, MappingInput } from './mapping.js';

/**
 * The named adapters: ServiceNow, Jira Service Management and Freshservice.
 *
 * Each is the generic HTTP source with the boxes filled in — the path on the
 * instance, where the records are, how the API pages, and a mapping from its
 * field names and its status words to ours. There is no per-vendor code
 * path, for the reason MOD-10 gave: a preset that drifts is a mapping to
 * correct rather than a connector to rewrite, and a tool none of these cover
 * is `http_json` with the same boxes filled by hand.
 *
 * The tenant supplies the instance (`baseUrl`) and a credential holding the
 * whole `Authorization` value — all three take HTTP Basic — and may override
 * any box. The status and priority tables are the vendors' defaults; a
 * tenant whose workflow renamed "Resolved" adds the new word to the map,
 * and until they do the row is reported rather than guessed.
 */

export const SOURCE_KINDS = ['csv', 'http_json', 'servicenow', 'jira', 'freshservice'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type Paging =
  | { kind: 'none' }
  /** Follow a URL in the response. */
  | { kind: 'link'; nextPath: string }
  /** `?offset=N&limit=L`, stopping when a page is short, a total is reached, or a flag says so. */
  | { kind: 'offset'; param: string; limitParam: string; limit: number; totalPath?: string; lastPagePath?: string }
  /** `?page=N&per_page=L`, stopping when a page is short or empty. */
  | { kind: 'page'; param: string; limitParam: string; limit: number; startAt?: number };

export interface Preset {
  /** Appended to the tenant's baseUrl; may carry a query string. */
  path?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  recordsPath?: string;
  paging?: Paging;
  credentialHeader?: string;
  mapping?: MappingInput;
  /** What an administrator needs to know before running it. */
  note?: string;
}

// ---- ServiceNow ------------------------------------------------------------
//
// The Table API. `sysparm_display_value=false` so reference fields come back
// as `{ link, value }` with the sys_id in `value`, which is what the link
// table remembers; dates come back as `YYYY-MM-DD HH:MM:SS` in UTC, which the
// date reader understands.

const SERVICENOW_STATES = { '1': 'new', '2': 'in_progress', '3': 'pending_requester', '6': 'resolved', '7': 'closed', '8': 'cancelled' };
const SERVICENOW_PRIORITIES = { '1': 'P1', '2': 'P2', '3': 'P3', '4': 'P4', '5': 'P4' };

const servicenow: Partial<Record<Entity, Preset>> = {
  users: {
    path: '/api/now/table/sys_user?sysparm_display_value=false&sysparm_query=active=true^emailISNOTEMPTY&sysparm_fields=sys_id,email,name,time_zone',
    recordsPath: 'result',
    paging: { kind: 'offset', param: 'sysparm_offset', limitParam: 'sysparm_limit', limit: 200 },
    mapping: { externalKeyFrom: 'sys_id', fields: { email: 'email', displayName: 'name', timeZone: 'time_zone' } },
    note: 'Active users with an email. Group membership is a separate table (sys_user_grmember); map it as a users job with fields.teams if you need it.',
  },
  teams: {
    path: '/api/now/table/sys_user_group?sysparm_display_value=false&sysparm_query=active=true&sysparm_fields=sys_id,name,description',
    recordsPath: 'result',
    paging: { kind: 'offset', param: 'sysparm_offset', limitParam: 'sysparm_limit', limit: 200 },
    mapping: { externalKeyFrom: 'sys_id', fields: { name: 'name', description: 'description' } },
  },
  services: {
    path: '/api/now/table/cmdb_ci_service?sysparm_display_value=false&sysparm_fields=sys_id,name,short_description',
    recordsPath: 'result',
    paging: { kind: 'offset', param: 'sysparm_offset', limitParam: 'sysparm_limit', limit: 200 },
    mapping: { externalKeyFrom: 'sys_id', fields: { name: 'name', description: 'short_description' } },
  },
  tickets: {
    path: '/api/now/table/incident?sysparm_display_value=false&sysparm_query=ORDERBYopened_at&sysparm_fields=sys_id,number,short_description,description,state,priority,caller_id,assigned_to,assignment_group,business_service,opened_at,resolved_at,closed_at',
    recordsPath: 'result',
    paging: { kind: 'offset', param: 'sysparm_offset', limitParam: 'sysparm_limit', limit: 200 },
    mapping: {
      externalKeyFrom: 'sys_id',
      fields: {
        reference: 'number',
        title: 'short_description',
        description: 'description',
        status: 'state',
        priority: 'priority',
        requester: 'caller_id.value',
        assignee: 'assigned_to.value',
        team: 'assignment_group.value',
        service: 'business_service.value',
        createdAt: 'opened_at',
        resolvedAt: 'resolved_at',
        closedAt: 'closed_at',
      },
      constants: { type: 'incident' },
      valueMaps: { status: SERVICENOW_STATES, priority: SERVICENOW_PRIORITIES },
    },
    note: 'Incidents, oldest first. Run the users, teams and services jobs first so the sys_id references resolve.',
  },
  comments: {
    path: '/api/now/table/sys_journal_field?sysparm_display_value=false&sysparm_query=name=incident^elementINcomments,work_notes^ORDERBYsys_created_on&sysparm_fields=sys_id,element_id,element,value,sys_created_by,sys_created_on',
    recordsPath: 'result',
    paging: { kind: 'offset', param: 'sysparm_offset', limitParam: 'sysparm_limit', limit: 500 },
    mapping: {
      externalKeyFrom: 'sys_id',
      fields: { ticket: 'element_id', body: 'value', author: 'sys_created_by', createdAt: 'sys_created_on', visibility: 'element' },
      valueMaps: { visibility: { comments: 'public', work_notes: 'internal' } },
    },
    note: 'Journal entries for incidents. The author is a user_name, not an email, so comments are attributed to nobody unless a users job mapped user_name as the external key.',
  },
};

// ---- Jira Service Management -------------------------------------------------
//
// REST API 2, because it returns descriptions and comments as text where
// API 3 returns a document tree. Reporters and assignees are tried by
// account id first (the link table, if a users job ran) and then by the
// email, which Jira hides when a person's privacy settings say so.

const JIRA_STATES = {
  'To Do': 'new',
  Open: 'new',
  'Waiting for support': 'in_progress',
  'In Progress': 'in_progress',
  'Waiting for customer': 'pending_requester',
  Pending: 'pending_third_party',
  'Waiting for approval': 'pending_approval',
  Escalated: 'in_progress',
  Resolved: 'resolved',
  Done: 'closed',
  Closed: 'closed',
  Canceled: 'cancelled',
  Cancelled: 'cancelled',
};
const JIRA_PRIORITIES = { Highest: 'P1', High: 'P2', Medium: 'P3', Low: 'P4', Lowest: 'P4' };

const jira: Partial<Record<Entity, Preset>> = {
  users: {
    path: '/rest/api/2/users/search',
    recordsPath: '',
    paging: { kind: 'offset', param: 'startAt', limitParam: 'maxResults', limit: 100 },
    mapping: { externalKeyFrom: 'accountId', fields: { email: 'emailAddress', displayName: 'displayName', timeZone: 'timeZone' } },
    note: 'Every account the credential can see; rows without an email (privacy settings, app accounts) are reported, not imported.',
  },
  teams: {
    path: '/rest/api/2/group/bulk',
    recordsPath: 'values',
    paging: { kind: 'offset', param: 'startAt', limitParam: 'maxResults', limit: 50, lastPagePath: 'isLast' },
    mapping: { externalKeyFrom: 'groupId', fields: { name: 'name' } },
  },
  services: {
    path: '/rest/servicedeskapi/servicedesk',
    recordsPath: 'values',
    paging: { kind: 'offset', param: 'start', limitParam: 'limit', limit: 50, lastPagePath: 'isLastPage' },
    mapping: { externalKeyFrom: 'projectKey', fields: { key: 'projectKey', name: 'projectName' } },
    note: 'One service per service desk project; tickets link to it by project key.',
  },
  tickets: {
    path: '/rest/api/2/search?jql=ORDER%20BY%20created%20ASC&fields=summary,description,status,priority,reporter,assignee,created,resolutiondate,issuetype,project,comment',
    recordsPath: 'issues',
    paging: { kind: 'offset', param: 'startAt', limitParam: 'maxResults', limit: 100, totalPath: 'total' },
    mapping: {
      externalKeyFrom: 'id',
      fields: {
        reference: 'key',
        title: 'fields.summary',
        description: 'fields.description',
        status: 'fields.status.name',
        priority: 'fields.priority.name',
        requester: ['fields.reporter.accountId', 'fields.reporter.emailAddress'],
        assignee: ['fields.assignee.accountId', 'fields.assignee.emailAddress'],
        service: 'fields.project.key',
        createdAt: 'fields.created',
        resolvedAt: 'fields.resolutiondate',
      },
      constants: { type: 'incident' },
      valueMaps: { status: JIRA_STATES, priority: JIRA_PRIORITIES },
      comments: {
        from: 'fields.comment.comments',
        externalKeyFrom: 'id',
        fields: { body: 'body', author: ['author.accountId', 'author.emailAddress'], createdAt: 'created', visibility: 'jsdPublic' },
        valueMaps: { visibility: { true: 'public', false: 'internal' } },
      },
    },
    note: 'Issues oldest first, with their comments. Add a project to the jql in path to import one desk at a time.',
  },
};

// ---- Freshservice --------------------------------------------------------------
//
// Numeric ids everywhere, so run users (requesters, then agents), teams and
// services before tickets, and the ids resolve through the link table. The
// conversation on a ticket is a call per ticket in this API and is not read.

const FRESHSERVICE_STATES = { '2': 'new', '3': 'pending_requester', '4': 'resolved', '5': 'closed' };
const FRESHSERVICE_PRIORITIES = { '1': 'P4', '2': 'P3', '3': 'P2', '4': 'P1' };
const FRESHSERVICE_TYPES = { Incident: 'incident', 'Service Request': 'request' };

const freshservice: Partial<Record<Entity, Preset>> = {
  users: {
    path: '/api/v2/requesters',
    recordsPath: 'requesters',
    paging: { kind: 'page', param: 'page', limitParam: 'per_page', limit: 100, startAt: 1 },
    mapping: { externalKeyFrom: 'id', fields: { email: 'primary_email', displayName: ['first_name', 'last_name'], timeZone: 'time_zone' } },
    note: 'Requesters. Run it again with path /api/v2/agents and recordsPath agents (fields.email instead of primary_email) for the agents.',
  },
  teams: {
    path: '/api/v2/groups',
    recordsPath: 'groups',
    paging: { kind: 'page', param: 'page', limitParam: 'per_page', limit: 100, startAt: 1 },
    mapping: { externalKeyFrom: 'id', fields: { name: 'name', description: 'description' } },
  },
  services: {
    path: '/api/v2/service_catalog/items',
    recordsPath: 'service_items',
    paging: { kind: 'page', param: 'page', limitParam: 'per_page', limit: 100, startAt: 1 },
    mapping: { externalKeyFrom: 'id', fields: { name: 'name', description: 'short_description' } },
  },
  tickets: {
    path: '/api/v2/tickets?order_type=asc&include=requester',
    recordsPath: 'tickets',
    paging: { kind: 'page', param: 'page', limitParam: 'per_page', limit: 100, startAt: 1 },
    mapping: {
      externalKeyFrom: 'id',
      fields: {
        reference: 'id',
        title: 'subject',
        description: 'description_text',
        type: 'type',
        status: 'status',
        priority: 'priority',
        requester: ['requester_id', 'requester.email'],
        assignee: 'responder_id',
        team: 'group_id',
        createdAt: 'created_at',
      },
      valueMaps: { status: FRESHSERVICE_STATES, priority: FRESHSERVICE_PRIORITIES, type: FRESHSERVICE_TYPES },
    },
    note: 'Tickets, oldest first. Freshservice does not return conversations with the ticket; they are not imported.',
  },
};

const PRESETS: Record<SourceKind, Partial<Record<Entity, Preset>>> = {
  csv: {},
  http_json: {},
  servicenow,
  jira,
  freshservice,
};

export function presetFor(kind: SourceKind, entity: Entity): Preset {
  return PRESETS[kind]?.[entity] ?? {};
}

export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}

/** What the API describes to an administrator choosing a source. */
export function describeSources(): { kind: SourceKind; entities: { entity: Entity; note: string | null; mapping: MappingInput | null }[] }[] {
  return SOURCE_KINDS.map((kind) => ({
    kind,
    entities: (Object.keys(PRESETS[kind]) as Entity[]).map((entity) => {
      const preset = PRESETS[kind][entity]!;
      return { entity, note: preset.note ?? null, mapping: preset.mapping ?? null };
    }),
  }));
}
