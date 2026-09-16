import { describe, expect, it } from 'vitest';
import { NOTIFYING_EVENTS, assertNotifiable, isNotifiable } from '../domain/notifying-events.js';

describe('the list of events MOD-11 listens for', () => {
  it('accepts a rule for an event it handles', () => {
    for (const eventType of NOTIFYING_EVENTS) {
      expect(isNotifiable(eventType)).toBe(true);
      expect(() => assertNotifiable(`rule-for-${eventType}`, eventType)).not.toThrow();
    }
  });

  it('refuses a rule for an event it does not, naming the rule and the list', () => {
    // A rule for an unlisted event was accepted, seeded, listed in the admin
    // console and never fired — three times in one day. It now stops the
    // process at registration, with enough in the message to fix it.
    expect(isNotifiable('status.incident.updated')).toBe(false);
    expect(() => assertNotifiable('status.incident.updated.default', 'status.incident.updated')).toThrow(
      /status\.incident\.updated\.default.*status\.incident\.updated.*NOTIFYING_EVENTS/s,
    );
  });
});
