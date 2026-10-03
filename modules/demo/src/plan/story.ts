import type { ServiceKey, TicketChannel } from './content-types.js';
import type { StoryCalendar } from './calendar.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, addDays, dayNumber, londonWall, ukInstant, type DateKey, type Instant } from './time.js';
import type { ComponentStatus, PlannedMajorIncident, PlannedMajorIncidentUpdate, PlannedStatusPage, PlannedWorkforce } from './types.js';

/**
 * The fixed story around the tickets (A4 §1.2, §1.9, §1.14): the four major
 * incidents, the status page, who is on call and what each persona's bell
 * holds. Times are relative to T0; the words are British English and name
 * nobody real.
 */

/** Rounds an instant down to five minutes, for times people quote ("the 08:05 rotation"). */
function hhmm(instant: Instant, roundTo = 5): string {
  const minutes = Math.floor(londonWall(instant).minutes / roundTo) * roundTo;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The first 08:30 UK after an instant. */
function nextHalfEight(after: Instant): Instant {
  let day = londonWall(after).dateKey;
  for (let guard = 0; guard < 3; guard += 1) {
    const instant = ukInstant(day, 8 * 60 + 30);
    if (instant > after) return instant;
    day = addDays(day, 1);
  }
  return after + DAY_MS;
}

/* ------------------------------------------------------------------ The major incidents */

export interface MajorIncidentTicketSpec {
  readonly majorIncident: 1 | 2 | 3 | 4;
  /** How many reports, and over which minutes relative to the incident's declaration. */
  readonly count: number;
  readonly from: Instant;
  readonly to: Instant;
  readonly channels: Readonly<Partial<Record<TicketChannel, number>>>;
  /** Reports still open with the network team (`aisha`) or unassigned in the Service Desk (R8). */
  readonly withAisha: number;
  /** When the incident's fix landed: historic reports are resolved shortly after. */
  readonly resolvedAt: Instant | null;
  readonly subcategory: 'vpn' | 'site-connectivity' | 'sage-intacct' | 'app-access';
  readonly title: string;
}

export interface MajorIncidentStory {
  readonly incidents: readonly PlannedMajorIncident[];
  readonly reports: readonly MajorIncidentTicketSpec[];
  readonly statusPage: PlannedStatusPage;
  /** The live incident's state at T0. */
  readonly liveState: 'mitigating' | 'monitoring';
  /** CHG-1192's moments, aligned with the live incident. */
  readonly emergencyChange: { readonly raisedAt: Instant; readonly implementingAt: Instant };
}

/** A business day near `key`: the day itself if it is one, else the one before. */
function onBusinessDay(calendar: StoryCalendar, key: DateKey): DateKey {
  let cursor = key;
  while (!calendar.isBusinessDay(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

/** The month-end day closest to `key` (MI-0002 is "forced onto that month's month-end"). */
function nearestMonthEnd(calendar: StoryCalendar, key: DateKey): DateKey {
  for (let offset = 0; offset < 40; offset += 1) {
    for (const candidate of [addDays(key, -offset), addDays(key, offset)]) {
      if (calendar.isMonthEnd(candidate) && dayNumber(candidate) < dayNumber(key) + 20) return candidate;
    }
  }
  return key;
}

const LIVE_TITLE = 'VPN sign-in failures for remote staff';
const BRIDGE = 'https://teams.example/l/meetup/vpn-bridge';

/**
 * How many reports each major incident had. The live incident's are the
 * presenter's (Alex's war room, Jordan's unowned urgent work) and do not
 * scale; the three historic ones are history, and scale with `DEMO_SCALE` as
 * every other ticket of the history does.
 */
export function majorIncidentReportCounts(scale: number, mode: 'day' | 'night'): Readonly<Record<1 | 2 | 3 | 4, number>> {
  const historic = (count: number) => Math.max(2, Math.round(count * scale));
  return { 1: historic(14), 2: historic(6), 3: historic(9), 4: mode === 'day' ? 18 : 9 };
}

export function planMajorIncidents(t0: Instant, mode: 'day' | 'night', calendar: StoryCalendar, scale = 1): MajorIncidentStory {
  const counts = majorIncidentReportCounts(scale, mode);
  const today = londonWall(t0).dateKey;
  const at = (key: DateKey, time: string): Instant => {
    const [h, m] = time.split(':').map(Number) as [number, number];
    return ukInstant(key, h * 60 + m);
  };

  /* -------------------------------------------- MI-0001, D−61: Leeds offline */
  const d61 = onBusinessDay(calendar, addDays(today, -61));
  const mi1: PlannedMajorIncident = {
    number: 1,
    title: 'Leeds Distribution Centre offline',
    severity: 'SEV1',
    declaredAt: at(d61, '10:05'),
    declaredBy: 'daniel-hughes',
    roles: { commander: 'daniel-hughes', comms: 'jordan-lee', scribe: 'aisha-rahman' },
    services: ['network-vpn', 'warehouse-wms'],
    customerFacing: false,
    state: 'closed',
    updateIntervalMinutes: 30,
    nextUpdateDueAt: null,
    updates: [
      { at: at(d61, '10:05'), kind: 'status', audience: 'internal', author: 'daniel-hughes', body: 'Declared. Leeds has no network: scanners, the WMS and the phones in the warehouse are down.' },
      { at: at(d61, '10:20'), kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: 'Leeds Distribution Centre is offline. Picking has stopped; London and Bristol are not affected. Next update by 10:50.' },
      { at: at(d61, '10:35'), kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'identified', body: 'BT confirm a fibre cut on the circuit into Leeds. An engineer is on the way.' },
      { at: at(d61, '11:10'), kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'mitigating', body: 'Failing Leeds over to the 4G backup router so the WMS can reach the database again.' },
      { at: at(d61, '11:40'), kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: 'Leeds is running on the backup link. Scanners are reconnecting; expect it to be slow until BT finish the repair.' },
      { at: at(d61, '12:15'), kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'resolved', body: 'BT have spliced the fibre. Leeds is back on its main circuit and picking has caught up.' },
      { at: at(addDays(d61, 3), '15:00'), kind: 'status', audience: 'internal', author: 'jordan-lee', to: 'closed', body: 'Post-incident review published. Closing.' },
    ],
    tickets: [],
    problem: 416,
    review: {
      state: 'published',
      summary: 'A fibre cut on the single BT circuit into Leeds took the site offline for two hours. There was no automatic failover; the 4G backup was brought up by hand.',
      savedAt: at(addDays(d61, 2), '16:00'),
      publishedAt: at(addDays(d61, 3), '15:00'),
      actions: [
        { title: 'Order a second, diverse circuit for Leeds', owner: 'daniel-hughes', done: true, dueAt: at(addDays(d61, 21), '17:00') },
        { title: 'Make the 4G backup take over automatically', owner: 'aisha-rahman', done: true, dueAt: at(addDays(d61, 14), '17:00') },
        { title: 'Add the Leeds circuit to the monitoring dashboard', owner: 'aisha-rahman', done: false, dueAt: at(addDays(d61, 70), '17:00') },
        { title: 'Rehearse the Leeds outage runbook with the warehouse leads', owner: 'gareth-pryce', done: false, dueAt: at(addDays(d61, 90), '17:00') },
      ],
    },
  };

  /* -------------------------------------------- MI-0002, D−34 on month-end: the bank file */
  const d34 = nearestMonthEnd(calendar, addDays(today, -34));
  const mi2: PlannedMajorIncident = {
    number: 2,
    title: 'Supplier payment file export times out',
    severity: 'SEV2',
    declaredAt: at(d34, '14:20'),
    declaredBy: 'liam-walsh',
    roles: { commander: 'liam-walsh', comms: 'jordan-lee', scribe: 'hannah-becker' },
    services: ['finance-systems'],
    customerFacing: false,
    state: 'closed',
    updateIntervalMinutes: 30,
    nextUpdateDueAt: null,
    updates: [
      { at: at(d34, '14:20'), kind: 'status', audience: 'internal', author: 'liam-walsh', body: 'Declared. The supplier payment export from Sage Intacct times out; today’s payment run is due at the bank by 16:00.' },
      { at: at(d34, '14:30'), kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: 'Finance cannot send today’s supplier payments yet. We are working on it. Next update by 15:00.' },
      { at: at(d34, '14:45'), kind: 'status', audience: 'internal', author: 'liam-walsh', to: 'identified', body: 'The bank export report hits its time limit at month-end volumes.' },
      { at: at(d34, '15:05'), kind: 'status', audience: 'internal', author: 'liam-walsh', to: 'mitigating', body: 'Running the export in two halves by supplier group.' },
      { at: at(d34, '15:30'), kind: 'status', audience: 'internal', author: 'liam-walsh', to: 'resolved', body: 'Both files accepted by the bank at 15:26. Payments will go today.' },
      { at: at(addDays(d34, 2), '12:00'), kind: 'status', audience: 'internal', author: 'jordan-lee', to: 'closed', body: 'Review published; problem PRB-0414 holds the fix.' },
    ],
    tickets: [],
    problem: 414,
    review: {
      state: 'published',
      summary: 'The bank export report timed out at month-end volumes. Splitting the file got the payments out; the report’s time limit is raised in the fix.',
      savedAt: at(addDays(d34, 1), '16:30'),
      publishedAt: at(addDays(d34, 2), '12:00'),
      actions: [
        { title: 'Raise the export report’s time limit', owner: 'liam-walsh', done: true, dueAt: at(addDays(d34, 10), '17:00') },
        { title: 'Add the payment run to the month-end support rota', owner: 'hannah-becker', done: true, dueAt: at(addDays(d34, 7), '17:00') },
      ],
    },
  };

  /* -------------------------------------------- MI-0003, D−12: Salesforce sign-in */
  const d12 = onBusinessDay(calendar, addDays(today, -12));
  const mi3: PlannedMajorIncident = {
    number: 3,
    title: 'Salesforce single sign-on failing',
    severity: 'SEV2',
    declaredAt: at(d12, '09:10'),
    declaredBy: 'chloe-nguyen',
    roles: { commander: 'chloe-nguyen', comms: 'jordan-lee', scribe: 'ryan-webb' },
    services: ['salesforce', 'identity-access'],
    customerFacing: false,
    state: 'resolved',
    updateIntervalMinutes: 30,
    nextUpdateDueAt: null,
    updates: [
      { at: at(d12, '09:10'), kind: 'status', audience: 'internal', author: 'chloe-nguyen', body: 'Declared. Nobody can sign in to Salesforce with their Northwind account.' },
      { at: at(d12, '09:15'), kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: 'Salesforce sign-in is failing for everyone. Sales calls can carry on; updates to opportunities will have to wait. Next update by 09:45.' },
      { at: at(d12, '09:25'), kind: 'status', audience: 'internal', author: 'chloe-nguyen', to: 'identified', body: 'The SAML signing certificate expired overnight.' },
      { at: at(d12, '09:40'), kind: 'status', audience: 'internal', author: 'chloe-nguyen', to: 'mitigating', body: 'New certificate uploaded to Entra ID and Salesforce; testing with the sales team.' },
      { at: at(d12, '10:00'), kind: 'status', audience: 'internal', author: 'chloe-nguyen', to: 'resolved', body: 'Sign-in works again for everyone we have asked. Review to follow.' },
    ],
    tickets: [],
    problem: 417,
    review: {
      state: 'draft',
      summary: 'The SAML certificate for Salesforce expired without warning: nothing was watching its expiry date.',
      savedAt: at(addDays(d12, 2), '11:00'),
      publishedAt: null,
      actions: [{ title: 'Alert 30 days before any SSO certificate expires', owner: 'ryan-webb', done: false, dueAt: at(addDays(d12, 30), '17:00') }],
    },
  };

  /* -------------------------------------------- MI-0004: live at T0 */
  const day = mode === 'day';
  const rel = (minutes: number): Instant => t0 + minutes * MINUTE_MS;
  const declaredAt = rel(day ? -55 : -140);
  const rotation = hhmm(declaredAt - 50 * MINUTE_MS);
  const stakeholderAt = rel(day ? -40 : -125);
  const lastUpdateAt = rel(day ? -8 : -25);
  const nextDue = day ? rel(52) : nextHalfEight(t0);
  const intervalMinutes = Math.min(1440, Math.max(15, Math.round((nextDue - lastUpdateAt) / MINUTE_MS)));
  const firstNextBy = hhmm(stakeholderAt + 60 * MINUTE_MS);
  const articleTitle = 'Connect to the VPN when it says “Authentication failed”';
  const updates: PlannedMajorIncidentUpdate[] = day
    ? [
        { at: declaredAt, kind: 'status', audience: 'internal', author: 'daniel-hughes', body: `Declared. Remote staff report “Authentication failed” from the VPN client.` },
        { at: rel(-48), kind: 'observation', audience: 'internal', author: 'aisha-rahman', body: `Gateway logs show certificate-chain errors since the ${rotation} rotation.` },
        { at: stakeholderAt, kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: `Remote staff may be unable to connect to the VPN. Office users are not affected. Next update by ${firstNextBy}.` },
        { at: rel(-22), kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'identified', body: 'The new intermediate certificate on both gateways is missing from the chain the clients are sent.' },
        { at: rel(-15), kind: 'action', audience: 'internal', author: 'daniel-hughes', body: 'Emergency change CHG-1192 raised to reissue the intermediate certificate.' },
        { at: lastUpdateAt, kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'mitigating', body: 'Reissuing the certificate on vpn-gw-ldn-01 first, then vpn-gw-ldn-02.' },
        { at: lastUpdateAt + MINUTE_MS, kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: `Fix being applied. Workaround: the knowledge article “${articleTitle}”.` },
      ]
    : [
        { at: declaredAt, kind: 'status', audience: 'internal', author: 'daniel-hughes', body: 'Declared. Remote staff report “Authentication failed” from the VPN client.' },
        { at: rel(-133), kind: 'observation', audience: 'internal', author: 'aisha-rahman', body: `Gateway logs show certificate-chain errors since the ${rotation} rotation.` },
        { at: stakeholderAt, kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: `Remote staff may be unable to connect to the VPN. Office users are not affected. Next update by ${firstNextBy}.` },
        { at: rel(-95), kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'identified', body: 'The new intermediate certificate on both gateways is missing from the chain the clients are sent.' },
        { at: rel(-80), kind: 'action', audience: 'internal', author: 'daniel-hughes', body: 'Emergency change CHG-1192 raised to reissue the intermediate certificate.' },
        { at: rel(-70), kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'mitigating', body: 'Reissuing the certificate on both gateways.' },
        { at: lastUpdateAt, kind: 'status', audience: 'internal', author: 'daniel-hughes', to: 'monitoring', body: 'Both gateways now send the full chain. Watching the sign-in failure rate overnight.' },
        { at: lastUpdateAt + MINUTE_MS, kind: 'comms', audience: 'stakeholders', author: 'jordan-lee', body: 'The certificate has been reissued and most people can connect. We’re monitoring overnight. Next update 08:30.' },
      ];
  const mi4: PlannedMajorIncident = {
    number: 4,
    title: LIVE_TITLE,
    severity: 'SEV2',
    declaredAt,
    declaredBy: 'daniel-hughes',
    roles: { commander: 'daniel-hughes', comms: 'jordan-lee', scribe: 'aisha-rahman' },
    services: ['network-vpn', 'identity-access'],
    customerFacing: false,
    bridgeUrl: BRIDGE,
    state: day ? 'mitigating' : 'monitoring',
    updateIntervalMinutes: intervalMinutes,
    nextUpdateDueAt: nextDue,
    updates,
    tickets: [],
    problem: 418,
  };

  /* -------------------------------------------- The reports raised against them */
  const reports: MajorIncidentTicketSpec[] = [
    { majorIncident: 1, count: counts[1], from: mi1.declaredAt - 5 * MINUTE_MS, to: at(d61, '12:00'), channels: { teams: 5, voice: 4, email: 3, system: 2 }, withAisha: counts[1], resolvedAt: at(d61, '12:15'), subcategory: 'site-connectivity', title: 'Leeds' },
    { majorIncident: 2, count: counts[2], from: mi2.declaredAt - 10 * MINUTE_MS, to: at(d34, '15:20'), channels: { email: 3, voice: 2, teams: 1 }, withAisha: 0, resolvedAt: at(d34, '15:30'), subcategory: 'sage-intacct', title: 'Sage' },
    { majorIncident: 3, count: counts[3], from: mi3.declaredAt - 8 * MINUTE_MS, to: at(d12, '09:55'), channels: { email: 3, teams: 3, portal: 2, voice: 1 }, withAisha: 0, resolvedAt: at(d12, '10:00'), subcategory: 'app-access', title: 'Salesforce' },
    day
      ? { majorIncident: 4, count: 18, from: rel(-52), to: rel(-5), channels: { email: 7, portal: 5, teams: 4, voice: 2 }, withAisha: 7, resolvedAt: null, subcategory: 'vpn', title: 'VPN' }
      : { majorIncident: 4, count: 9, from: declaredAt + 5 * MINUTE_MS, to: t0 - 10 * MINUTE_MS, channels: { email: 4, portal: 3, teams: 2 }, withAisha: 4, resolvedAt: null, subcategory: 'vpn', title: 'VPN' },
  ];

  /* -------------------------------------------- The status page */
  const live: ComponentStatus = day ? 'partial_outage' : 'degraded';
  const identity: ComponentStatus = day ? 'degraded' : 'operational';
  const statusPage: PlannedStatusPage = {
    components: (
      ['microsoft-365', 'network-vpn', 'end-user-devices', 'printing', 'salesforce', 'finance-systems', 'hr-systems', 'warehouse-wms', 'identity-access'] as ServiceKey[]
    ).map((service) => ({
      service,
      status: service === 'network-vpn' ? live : service === 'identity-access' ? identity : 'operational',
    })),
    incidents: [
      {
        majorIncident: 1,
        title: 'Leeds Distribution Centre connectivity',
        openedAt: mi1.declaredAt + 10 * MINUTE_MS,
        resolvedAt: at(d61, '12:20'),
        components: [{ service: 'warehouse-wms', status: 'major_outage' }, { service: 'network-vpn', status: 'partial_outage' }],
        updates: [
          { at: mi1.declaredAt + 10 * MINUTE_MS, status: 'investigating', body: 'Our Leeds site has lost its network connection. We are working with our provider.' },
          { at: at(d61, '10:40'), status: 'identified', body: 'A cable fault outside the site has been found and an engineer is on the way.' },
          { at: at(d61, '12:20'), status: 'resolved', body: 'Leeds is fully connected again.' },
        ],
      },
      {
        majorIncident: 2,
        title: 'Supplier payments delayed',
        openedAt: at(d34, '14:30'),
        resolvedAt: at(d34, '15:35'),
        components: [{ service: 'finance-systems', status: 'degraded' }],
        updates: [
          { at: at(d34, '14:30'), status: 'investigating', body: 'Supplier payment exports are failing. Payments are not yet affected.' },
          { at: at(d34, '15:35'), status: 'resolved', body: 'Today’s supplier payments have been sent.' },
        ],
      },
      {
        majorIncident: 3,
        title: 'Salesforce sign-in',
        openedAt: at(d12, '09:15'),
        resolvedAt: at(d12, '10:05'),
        components: [{ service: 'salesforce', status: 'major_outage' }],
        updates: [
          { at: at(d12, '09:15'), status: 'investigating', body: 'Signing in to Salesforce is failing. We are investigating.' },
          { at: at(d12, '09:30'), status: 'identified', body: 'An expired sign-in certificate is the cause. A replacement is being installed.' },
          { at: at(d12, '10:05'), status: 'resolved', body: 'Salesforce sign-in is working again.' },
        ],
      },
      {
        majorIncident: 4,
        title: 'VPN connection problems for remote staff',
        openedAt: stakeholderAt + 2 * MINUTE_MS,
        resolvedAt: null,
        components: [
          { service: 'network-vpn', status: live },
          { service: 'identity-access', status: identity },
        ],
        updates: day
          ? [
              { at: stakeholderAt + 2 * MINUTE_MS, status: 'investigating', body: 'Some people working from home cannot connect to the VPN. Office connections are not affected.' },
              { at: rel(-20), status: 'identified', body: 'We have found the cause and a fix is being prepared.' },
              { at: lastUpdateAt + 2 * MINUTE_MS, status: 'identified', body: 'The fix is being applied. If you cannot connect, follow the knowledge article on “Authentication failed”.' },
            ]
          : [
              { at: stakeholderAt + 2 * MINUTE_MS, status: 'investigating', body: 'Some people working from home cannot connect to the VPN. Office connections are not affected.' },
              { at: rel(-90), status: 'identified', body: 'We have found the cause and a fix is being applied.' },
              { at: lastUpdateAt + 2 * MINUTE_MS, status: 'monitoring', body: 'A fix is in place and most people can connect. We are monitoring overnight.' },
            ],
      },
    ],
    maintenance: [],
  };

  return {
    incidents: [mi1, mi2, mi3, mi4],
    reports,
    statusPage,
    liveState: day ? 'mitigating' : 'monitoring',
    emergencyChange: day ? { raisedAt: rel(-15), implementingAt: rel(-10) } : { raisedAt: rel(-80), implementingAt: rel(-75) },
  };
}

/** The auto-acknowledgement every report of a major incident receives (an automated public reply). */
export function majorIncidentAcknowledgement(number: number): string {
  return `Thanks for letting us know. This is part of a wider problem we are already working on (MI-${String(number).padStart(4, '0')}). You can follow progress on the status page; there is no need to chase.`;
}

/* ------------------------------------------------------------------ Workforce (A4 §1.2) */

export function planWorkforce(t0: Instant, calendar: StoryCalendar): PlannedWorkforce {
  // "Relative to the next working morning when T0 falls outside working hours."
  const wall = londonWall(t0);
  const inHours = calendar.isBusinessDay(wall.dateKey) && wall.minutes < 17 * 60 + 30;
  const morning = inHours ? wall.dateKey : calendar.businessDayOnOrAfter(addDays(wall.dateKey, wall.minutes >= 17 * 60 + 30 || !calendar.isBusinessDay(wall.dateKey) ? 1 : 0));
  const untilOn = (minutes: number): Instant => {
    const instant = ukInstant(morning, minutes);
    return instant > t0 ? instant : t0 + HOUR_MS;
  };
  // The on-call week runs Monday 09:00 to Monday 09:00, UK time.
  let monday = wall.dateKey;
  for (let guard = 0; guard < 7 && new Date(dayNumber(monday) * DAY_MS).getUTCDay() !== 1; guard += 1) monday = addDays(monday, -1);
  if (ukInstant(monday, 9 * 60) > t0) monday = addDays(monday, -7);
  const weekStart = ukInstant(monday, 9 * 60);
  const weekEnd = ukInstant(addDays(monday, 7), 9 * 60);
  return {
    availability: [
      { person: 'alex-morgan', state: 'available', until: null },
      { person: 'priya-shah', state: 'busy', until: untilOn(11 * 60) },
      { person: 'tom-fletcher', state: 'away', until: untilOn(14 * 60) },
      { person: 'grace-okafor', state: 'available', until: null },
      { person: 'daniel-hughes', state: 'on_call', until: null },
    ],
    onCall: [
      { rota: 'network-oncall', person: 'daniel-hughes', from: weekStart, to: weekEnd },
      { rota: 'security-oncall', person: 'ryan-webb', from: weekStart, to: weekEnd },
    ],
  };
}
