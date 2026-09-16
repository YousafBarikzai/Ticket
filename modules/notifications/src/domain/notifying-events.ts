/**
 * The event types MOD-11 registers a handler for.
 *
 * The rule table accepts a rule for any event type at all; a handler exists
 * only for these. A rule for anything else would be accepted, listed and never
 * fire — which is how three modules in one day shipped a notification nobody
 * would have received. So the list lives here, on its own, and everything
 * that adds a rule checks against it (`assertNotifiable`) at registration:
 * the process fails to start rather than the message failing to arrive.
 */
export const NOTIFYING_EVENTS = [
  'ticket.created',
  'ticket.status.changed',
  'ticket.assigned',
  'ticket.comment.added',
  'sla.timer.warning',
  'sla.timer.breached',
  'report.generated',
  'survey.invited',
  'budget.threshold.reached',
] as const;

const notifiable: ReadonlySet<string> = new Set(NOTIFYING_EVENTS);

export function isNotifiable(eventType: string): boolean {
  return notifiable.has(eventType);
}

/** Throws, naming the rule, when a rule names an event no handler listens for. */
export function assertNotifiable(ruleKey: string, eventType: string): void {
  if (!isNotifiable(eventType)) {
    throw new Error(
      `notification rule "${ruleKey}" names ${eventType}, which MOD-11 does not listen for; add it to NOTIFYING_EVENTS in modules/notifications/src/domain/notifying-events.ts`,
    );
  }
}
