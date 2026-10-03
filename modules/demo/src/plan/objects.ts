import type { StoryCalendar } from './calendar.js';
import type { ChangeContent, DemoContent, KnowledgeKey, ProblemContent, SubcategoryKey } from './content-types.js';
import { LIVE_INCIDENT_ARTICLE } from './content-types.js';
import { streamFor } from './rng.js';
import type { MajorIncidentStory } from './story.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, addDays, londonWall, ukInstant, wallMinutes, weekdayOf, type DateKey, type Instant } from './time.js';
import type {
  PlannedAiSample,
  PlannedApproval,
  PlannedArticle,
  PlannedChange,
  PlannedNotification,
  PlannedProblem,
  PlannedStatusPage,
  PlannedTicket,
  PlannedTicketLink,
} from './types.js';
import type { Words } from './words.js';

/**
 * The records around the tickets (A4 §1.5, §1.9, §1.14): problems and the
 * incidents linked to them, the 42 changes and their CAB approvals, knowledge
 * usage, the sample AI decisions and each persona's notifications. They are
 * keyed on T0 — "PRB-0412 was raised 52 days ago" — and drawn from the
 * tickets already planned, so a problem links tickets that exist.
 */

export interface ObjectInputs {
  readonly content: DemoContent;
  readonly seed: number;
  readonly t0: Instant;
  readonly t0Date: DateKey;
  readonly mode: 'day' | 'night';
  readonly calendar: StoryCalendar;
  readonly tickets: readonly PlannedTicket[];
  readonly story: MajorIncidentStory;
  readonly reportsByIncident: ReadonlyMap<number, readonly string[]>;
  readonly words: Words;
  readonly firstNameOf: (key: string) => string;
}

export interface PlannedObjects {
  readonly links: readonly PlannedTicketLink[];
  readonly approvals: readonly PlannedApproval[];
  readonly knowledge: readonly PlannedArticle[];
  readonly problems: readonly PlannedProblem[];
  readonly changes: readonly PlannedChange[];
  readonly maintenance: PlannedStatusPage['maintenance'];
  readonly aiSamples: readonly PlannedAiSample[];
  readonly notifications: readonly PlannedNotification[];
}

const at = (key: DateKey, time: string): Instant => ukInstant(key, wallMinutes(time));
const finished = (ticket: PlannedTicket) => ticket.status === 'resolved' || ticket.status === 'closed';

/** Which subcategories an article answers, for its "used to resolve" links. */
const ARTICLE_SUBCATEGORIES: Readonly<Partial<Record<KnowledgeKey, readonly SubcategoryKey[]>>> = Object.freeze({
  'email-on-phone': ['outlook'],
  'office-wifi': ['wifi'],
  'vpn-from-home': ['vpn'],
  'meeting-room-screens': ['meeting-room-av'],
  'authenticator-new-phone': ['mfa'],
  'share-securely': ['onedrive-sharepoint'],
  'shared-mailbox-howto': ['mailbox-drive-access'],
  'out-of-office': ['outlook', 'questions'],
  'outlook-password-prompt': ['outlook', 'password-sign-in'],
  'printer-offline': ['printer'],
  'mapped-drive-missing': ['onedrive-sharepoint'],
  'dock-black-screen': ['monitor-dock'],
  'teams-camera': ['teams'],
  'onedrive-sync-paused': ['onedrive-sharepoint'],
  'password-policy': ['password-sign-in'],
  'rb-unlock-account': ['password-sign-in'],
  'rb-reset-mfa': ['mfa'],
  'rb-new-starter': ['joiners-leavers'],
  'rb-leaver': ['joiners-leavers'],
  'rb-month-end': ['sage-intacct'],
});

/** Who keeps each kind of article. */
function ownerOf(key: KnowledgeKey, category: string): string {
  if (key.startsWith('rb-')) return key === 'rb-month-end' ? 'liam-walsh' : key === 'rb-major-incident' ? 'jordan-lee' : 'chloe-nguyen';
  if (key.startsWith('vpn') || key === 'office-wifi') return 'daniel-hughes';
  if (category === 'policies') return 'jordan-lee';
  if (category === 'troubleshooting') return 'grace-okafor';
  return 'priya-shah';
}

export function planObjects(inputs: ObjectInputs): PlannedObjects {
  const { content, seed, t0, t0Date, mode, calendar, tickets, story, reportsByIncident } = inputs;
  const byRef = new Map(tickets.map((ticket) => [ticket.ref, ticket]));
  const links: PlannedTicketLink[] = [];
  const approvals: PlannedApproval[] = [];

  /* -------------------------------------------------- Problems (A4 §1.9.1) */
  const usedForProblems = new Set<string>();
  const problems = content.problems.map((problem): PlannedProblem => planProblem(problem));

  function planProblem(problem: ProblemContent): PlannedProblem {
    const raisedDay = calendar.businessDayOnOrAfter(addDays(t0Date, -problem.raisedDaysBeforeT0));
    const createdAt = Math.min(at(raisedDay, '11:20'), t0 - HOUR_MS);
    const linked: { ref: string; at: Instant }[] = [];
    const link = (ref: string) => {
      const ticket = byRef.get(ref);
      if (!ticket || usedForProblems.has(ref)) return;
      usedForProblems.add(ref);
      linked.push({ ref, at: Math.min(t0 - MINUTE_MS, Math.max(createdAt, ticket.createdAt) + HOUR_MS) });
    };
    for (const source of problem.links) {
      let candidates: PlannedTicket[];
      switch (source.source) {
        case 'major-incident':
          candidates = (problem.majorIncident ? (reportsByIncident.get(problem.majorIncident) ?? []) : []).map((ref) => byRef.get(ref)!).filter(Boolean);
          break;
        case 'early-vpn':
          candidates = tickets.filter((ticket) => ticket.ref.startsWith('demo:o:vpn:'));
          break;
        case 'rollout':
          candidates = tickets.filter((ticket) => ticket.ref.startsWith('demo:o:rollout:') && ticket.subcategory === problem.subcategory);
          break;
        default:
          // The most recent incidents of its subcategory, before T0.
          candidates = tickets
            .filter((ticket) => ticket.ref.startsWith('demo:t:') && ticket.type === 'incident' && ticket.subcategory === problem.subcategory && ticket.createdAt >= createdAt - 45 * DAY_MS)
            .reverse();
      }
      // Every report of a major incident; otherwise the number the content asks for.
      candidates.slice(0, source.source === 'major-incident' ? candidates.length : source.count).forEach((ticket) => link(ticket.ref));
    }
    for (const hero of problem.heroes ?? []) link(`demo:hero:${hero}`);

    // Its lifecycle up to its state at T0.
    const transitions: PlannedProblem['transitions'][number][] = [];
    const step = (days: number, to: 'known_error' | 'resolved' | 'closed') => {
      const when = Math.min(t0 - 30 * MINUTE_MS, createdAt + days * DAY_MS);
      transitions.push({ to, at: when });
    };
    if (problem.state === 'known_error') step(Math.max(1, Math.min(4, problem.raisedDaysBeforeT0 / 3)), 'known_error');
    if (problem.state === 'resolved' || problem.state === 'closed') {
      step(Math.max(1, problem.raisedDaysBeforeT0 / 4), 'known_error');
      step(Math.max(2, problem.raisedDaysBeforeT0 / 2), 'resolved');
    }
    if (problem.state === 'closed') step(Math.max(3, (problem.raisedDaysBeforeT0 * 3) / 4), 'closed');
    return {
      number: problem.number,
      title: problem.title,
      description: problem.description,
      priority: problem.priority,
      owner: problem.owner,
      team: problem.team,
      service: problem.service,
      createdAt,
      transitions,
      state: problem.state,
      ...(problem.workaround ? { workaround: problem.workaround } : {}),
      ...(problem.workaroundArticle ? { workaroundArticle: problem.workaroundArticle } : {}),
      ...(problem.rootCause ? { rootCause: problem.rootCause } : {}),
      ...(problem.majorIncident ? { majorIncident: problem.majorIncident } : {}),
      tickets: linked.sort((a, b) => a.at - b.at),
    };
  }

  /* -------------------------------------------------- Changes (A4 §1.9.2) */
  const pendingCab = new Map<number, number>();
  const changes = [...content.changes].sort((a, b) => a.number - b.number).map((change) => planChange(change));

  function windowOf(change: ChangeContent): { start: Instant; end: Instant } | null {
    const when = change.when;
    switch (when.kind) {
      case 'past': {
        const start = at(addDays(t0Date, -when.daysBeforeT0), when.start);
        return { start, end: start + when.minutes * MINUTE_MS };
      }
      case 'week': {
        let day = addDays(t0Date, 1);
        while (weekdayOf(day) !== when.weekday) day = addDays(day, 1);
        day = addDays(day, 7 * when.weeksAhead);
        const start = at(day, when.start);
        return { start, end: start + when.minutes * MINUTE_MS };
      }
      case 'blackout': {
        const start = at(calendar.nextBlackoutStart(t0Date), when.start);
        return { start, end: start + when.minutes * MINUTE_MS };
      }
      case 'live':
        return { start: story.emergencyChange.implementingAt, end: story.emergencyChange.implementingAt + 60 * MINUTE_MS };
      case 'unscheduled':
        return null;
    }
  }

  function planChange(change: ChangeContent): PlannedChange {
    const window = windowOf(change);
    const rng = streamFor(seed, 'change', change.number);
    const live = change.when.kind === 'live';
    const leadDays = change.kind === 'standard' ? rng.int(2, 5) : rng.int(7, 14);
    const createdAt = live
      ? story.emergencyChange.raisedAt
      : window
        ? Math.min(t0 - 2 * DAY_MS, window.start - leadDays * DAY_MS)
        : t0 - rng.int(3, 12) * DAY_MS;
    const transitions: PlannedChange['transitions'][number][] = [];
    const push = (to: PlannedChange['transitions'][number]['to'], when: Instant) => transitions.push({ to, at: Math.min(when, t0 - MINUTE_MS) });
    const submittedAt = live ? createdAt + 2 * MINUTE_MS : createdAt + rng.int(20, 120) * MINUTE_MS;
    if (change.state !== 'draft') push('submitted', submittedAt);
    // A normal change goes to the CAB (Jordan); standard ones are pre-approved;
    // the emergency change is approved retrospectively, after the event.
    const decidedAt = change.kind === 'normal' ? calendar.businessClock.add(submittedAt, rng.int(4, 20) * HOUR_MS) : submittedAt + MINUTE_MS;
    if (change.kind === 'normal' && change.state !== 'draft') {
      const pending = change.state === 'submitted';
      // The two awaiting CAB at T0 (A4 §1.9.5): the guest Wi-Fi one six
      // business hours old, the WMS move a day and a bit.
      const requestedAt = pending ? calendar.businessClock.before(t0, (change.when.kind === 'blackout' ? 750 : 360) * MINUTE_MS) : submittedAt;
      if (pending) {
        transitions.length = 0;
        push('submitted', requestedAt);
        pendingCab.set(change.number, requestedAt);
      }
      approvals.push({
        subject: { kind: 'change', number: change.number },
        policy: 'cab',
        requestedBy: change.owner,
        approver: 'jordan-lee',
        requestedAt: Math.min(requestedAt, t0 - MINUTE_MS),
        outcome: pending ? 'pending' : 'approved',
        decidedAt: pending ? null : Math.min(decidedAt, t0 - MINUTE_MS),
      });
    }
    if (change.state === 'scheduled' || change.state === 'closed' || change.state === 'implementing') {
      if (change.kind !== 'emergency') push('approved', decidedAt);
      push('scheduled', (change.kind === 'emergency' ? submittedAt : decidedAt) + 30 * MINUTE_MS);
    }
    if ((change.state === 'closed' || change.state === 'implementing') && window) push('implementing', window.start);
    if (change.state === 'closed' && window) {
      push('review', window.end);
      push('closed', window.end + DAY_MS);
    }
    const inBlackout = window !== null && isInBlackout(window.start);
    return {
      number: change.number,
      title: change.title,
      description: change.description,
      kind: change.kind,
      risk: change.risk,
      impact: change.impact,
      team: change.team,
      owner: change.owner,
      service: change.service,
      createdAt: Math.min(createdAt, t0 - MINUTE_MS),
      window,
      transitions: transitions.sort((a, b) => a.at - b.at),
      state: change.state,
      ...(change.closeCode ? { closeCode: change.closeCode } : {}),
      maintenanceWindow: change.maintenanceWindow === true,
      inBlackout,
      retrospective: change.kind === 'emergency' && change.state === 'implementing',
      ...(change.majorIncident ? { majorIncident: change.majorIncident } : {}),
      ...(change.problem ? { problem: change.problem } : {}),
      ...(change.implementationPlan ? { implementationPlan: change.implementationPlan } : {}),
      ...(change.backoutPlan ? { backoutPlan: change.backoutPlan } : {}),
    };
  }

  /** The change blackout: the month's last two business days (A4 §1.9.2). */
  function isInBlackout(instant: Instant): boolean {
    const key = londonWall(instant).dateKey;
    if (!calendar.isBusinessDay(key)) return false;
    let cursor = addDays(key, 1);
    let later = 0;
    while (cursor.slice(0, 7) === key.slice(0, 7)) {
      if (calendar.isBusinessDay(cursor)) later += 1;
      cursor = addDays(cursor, 1);
    }
    return later <= 1;
  }

  const maintenance: PlannedStatusPage['maintenance'] = changes
    .filter((change) => change.maintenanceWindow && change.window && change.window.end > t0)
    .map((change) => ({ changeNumber: change.number, title: change.title, start: change.window!.start, end: change.window!.end, services: [change.service] }));

  /* -------------------------------------------------- Knowledge usage (A4 §1.5) */
  let resolvedLinks = 0;
  const knowledge = content.knowledge.map((article): PlannedArticle => {
    const rng = streamFor(seed, 'article', article.key);
    const live = article.key === LIVE_INCIDENT_ARTICLE;
    const published = article.state === 'published';
    const publishedAt = !published
      ? null
      : live
        ? t0 - (mode === 'day' ? 6 : 150) * MINUTE_MS
        : at(addDays(t0Date, -Math.max(1, article.publishedDaysAgo)), `${String(rng.int(9, 16)).padStart(2, '0')}:${String(rng.int(0, 5) * 10).padStart(2, '0')}`);
    const createdAt = publishedAt !== null ? publishedAt - rng.int(1, 3) * DAY_MS : t0 - rng.int(3, 9) * DAY_MS;
    const views = typeof article.views === 'number' ? article.views : article.views[mode];
    const votes = published ? Math.min(60, Math.max(live ? 3 : 2, Math.round(views * 0.09))) : 0;
    const helpful = Math.round((votes * article.helpfulPercent) / 100);
    const span = publishedAt !== null ? Math.max(MINUTE_MS, t0 - publishedAt) : 0;
    const feedback = Array.from({ length: votes }, (_, i) => ({
      helpful: i < helpful,
      at: (publishedAt ?? t0) + Math.round(rng.float() * span * 0.98),
    })).sort((a, b) => a.at - b.at);

    const resolved: { ticketRef: string; at: Instant }[] = [];
    if (publishedAt !== null) {
      const subcategories = live ? (['vpn'] as const) : (ARTICLE_SUBCATEGORIES[article.key] ?? []);
      // The live incident's article is linked to nine of its reports as it is
      // published; every other article to a share of the resolved tickets it
      // answers, after it was published (about 140 in all, A4 §1.5).
      const candidates = tickets.filter((ticket) =>
        live
          ? ticket.majorIncident === 4
          : ticket.ref.startsWith('demo:t:') && finished(ticket) && (subcategories as readonly string[]).includes(ticket.subcategory) && ticket.createdAt >= publishedAt,
      );
      const wanted = live ? 9 : Math.min(12, Math.ceil(candidates.length / 6));
      for (const ticket of candidates.slice(-wanted)) {
        if (resolvedLinks >= 160 && !live) break;
        const linkedAt = live ? Math.max(publishedAt, ticket.createdAt) + MINUTE_MS : (ticket.resolvedAt ?? ticket.createdAt) + MINUTE_MS;
        resolved.push({ ticketRef: ticket.ref, at: Math.min(t0 - MINUTE_MS, linkedAt) });
        if (!live) resolvedLinks += 1;
      }
    }
    return {
      key: article.key,
      title: article.title,
      summary: article.summary,
      category: article.category,
      audience: article.audience,
      state: article.state,
      owner: ownerOf(article.key, article.category),
      keywords: [...article.keywords],
      body: article.body,
      ...(article.service ? { service: article.service } : {}),
      createdAt,
      publishedAt,
      usage: { views: published ? views : 0, helpful, notHelpful: votes - helpful, feedback },
      resolved,
    };
  });

  /* -------------------------------------------------- AI samples (A4 §1.14, D13) */
  const aiSamples: PlannedAiSample[] = [];
  const recent = tickets.filter((ticket) => ticket.ref.startsWith('demo:t:') && ticket.createdAt >= t0 - 14 * DAY_MS && ticket.type !== 'question');
  const wantedSamples = 58;
  const stride = recent.length / Math.max(1, Math.min(wantedSamples, recent.length));
  for (let i = 0; i < Math.min(wantedSamples, recent.length); i += 1) {
    const ticket = recent[Math.floor(i * stride)]!;
    const rng = streamFor(seed, 'ai', ticket.ref);
    const response = i % 10 < 7 ? 'accepted' : i % 10 < 9 ? 'dismissed' : 'untouched';
    const suggestedAt = ticket.createdAt + 30_000;
    const respondedAt = response === 'untouched' ? null : Math.min(t0 - MINUTE_MS, suggestedAt + rng.int(2, 40) * MINUTE_MS);
    const wrongPriority = ticket.priority === 'P4' ? 'P3' : 'P4';
    aiSamples.push({
      ticketRef: ticket.ref,
      at: suggestedAt,
      suggestion: {
        subcategory: ticket.subcategory,
        team: ticket.team,
        priority: response === 'dismissed' ? wrongPriority : ticket.priority,
        summary: ticket.title,
      },
      response,
      respondedAt,
      respondedBy: response === 'untouched' ? null : (ticket.assignee ?? null),
      settled: finished(ticket),
    });
  }
  for (const hero of content.heroes) {
    if (!hero.aiSuggestion) continue;
    const ticket = byRef.get(`demo:hero:${hero.key}`);
    if (!ticket) continue;
    aiSamples.push({
      ticketRef: ticket.ref,
      at: ticket.createdAt + 30_000,
      suggestion: { subcategory: ticket.subcategory, team: ticket.team, priority: ticket.priority, summary: hero.aiSuggestion },
      response: 'untouched',
      respondedAt: null,
      respondedBy: null,
      settled: false,
    });
  }

  /* -------------------------------------------------- Notifications: four per persona, three unread (A4 §1.14) */
  const ref = (key: string) => `demo:hero:${key}`;
  const createdOf = (key: string) => byRef.get(ref(key))?.createdAt ?? t0 - HOUR_MS;
  const liveIncident = story.incidents.find((incident) => incident.number === 4)!;
  // Within the last four hours, or the previous working afternoon at night.
  const recentAt = (minutesAgo: number): Instant => {
    const instant = t0 - minutesAgo * MINUTE_MS;
    return mode === 'day' ? instant : calendar.businessClock.before(t0, minutesAgo * MINUTE_MS);
  };
  const lastComment = (key: string, author: 'requester' | 'agent') => {
    const ticket = byRef.get(ref(key));
    const comment = ticket?.comments.filter((c) => (author === 'requester' ? c.author === ticket.requester : c.author !== ticket.requester)).at(-1);
    return comment?.at ?? recentAt(60);
  };
  const tableau = byRef.get('demo:o:approval:1')?.events.find((event) => event.kind === 'status')?.at ?? recentAt(180);
  const cab = [...pendingCab.entries()].sort((a, b) => a[1] - b[1]);
  const titleOf = (key: string) => byRef.get(ref(key))?.title ?? '';
  const notify = (recipient: string, items: Omit<PlannedNotification, 'recipient' | 'readAt'>[]): PlannedNotification[] => {
    const ordered = [...items].sort((a, b) => a.createdAt - b.createdAt);
    return ordered.map((item, index) => ({
      recipient,
      ...item,
      createdAt: Math.min(item.createdAt, t0 - MINUTE_MS),
      // The oldest has been read; the other three wait.
      readAt: index === 0 ? Math.min(t0 - MINUTE_MS, item.createdAt + 10 * MINUTE_MS) : null,
    }));
  };
  const notifications: PlannedNotification[] = [
    ...notify('alex-morgan', [
      { ticketRef: ref('H5'), kind: 'assignment', subject: `Assigned to you: ${titleOf('H5')}`, body: 'Priya assigned this ticket to you.', createdAt: Math.max(createdOf('H5'), recentAt(110)) },
      { ticketRef: ref('A1'), kind: 'warning', subject: `Resolution due soon: ${titleOf('A1')}`, body: 'Three quarters of the resolution target has been used.', createdAt: recentAt(90) },
      { ticketRef: ref('H1'), kind: 'reply', subject: `Customer replied: ${titleOf('H1')}`, body: 'Marcus Chen replied to the ticket.', createdAt: lastComment('H1', 'requester') },
      { kind: 'incident', subject: `Major incident declared: MI-0004 ${liveIncident.title}`, body: 'Daniel Hughes is the incident commander.', createdAt: liveIncident.declaredAt + MINUTE_MS },
    ]),
    ...notify('emma-clarke', [
      { ticketRef: 'demo:o:approval:1', kind: 'approval', subject: 'Approval requested: Install software: Tableau Creator', body: 'Olivia Bennett is waiting for your decision.', createdAt: tableau },
      { ticketRef: ref('E4'), kind: 'reply', subject: `Is it fixed? ${titleOf('E4')}`, body: 'Let us know if it comes back.', createdAt: lastComment('E4', 'agent') },
      { ticketRef: ref('E1'), kind: 'reply', subject: `New reply: ${titleOf('E1')}`, body: 'Grace Okafor is waiting for your answer.', createdAt: lastComment('E1', 'agent') },
      { kind: 'incident', subject: 'Some people cannot connect to the VPN', body: 'We are working on it. Follow MI-0004 on the status page.', createdAt: liveIncident.declaredAt + 20 * MINUTE_MS },
    ]),
    ...notify('jordan-lee', [
      ...cab.map(([number, requestedAt]) => ({
        kind: 'approval' as const,
        subject: `CAB approval waiting: CHG-${number}`,
        body: `${changes.find((change) => change.number === number)?.title ?? 'A change'} is waiting for your decision.`,
        createdAt: requestedAt,
      })),
      { kind: 'incident', subject: `Major incident declared: MI-0004 ${liveIncident.title}`, body: 'You are the communications lead.', createdAt: liveIncident.declaredAt + MINUTE_MS },
      { kind: 'general', subject: '23 laptop warranties end within 30 days', body: 'The October 2023 batch of Dell Latitude laptops.', createdAt: recentAt(200) },
    ]).slice(0, 4),
  ];

  /*
   * Ticket-to-ticket links. A problem's incidents and a major incident's
   * reports are linked through the problem and the incident themselves; a
   * reopened ticket that came back as a new one would be a `related_to` here.
   * The story has none of those today, so the list stays empty, but the parts
   * write whatever it holds (`importLinks`).
   */
  return {
    links: links.filter((link) => link.at < t0),
    approvals,
    knowledge,
    problems,
    changes,
    maintenance,
    aiSamples: aiSamples.sort((a, b) => a.at - b.at),
    notifications,
  };
}

