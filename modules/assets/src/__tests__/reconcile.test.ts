import { describe, expect, it } from 'vitest';
import { agrees, fingerprint, flatten, policyFor, reconcile, unflatten, type Rule } from '../domain/reconcile.js';

/**
 * The decision this whole epic turns on: what happens when the feed and the
 * register disagree. The default is that a person decides, and every test here
 * is about a way that default could be bypassed by accident.
 */

const noRules: Rule[] = [];
const sourceId = 'intune';

describe('policyFor', () => {
  it('proposes by default, with no rules at all', () => {
    expect(policyFor(noRules, 'attributes.serial', sourceId)).toBe('propose');
  });

  it('lets a rule for one source beat a rule for every source', () => {
    // "Trust Intune's serials, nothing else's" has to be sayable without
    // writing a rule per source for every other field.
    const rules: Rule[] = [
      { sourceId: null, field: 'attributes.serial', policy: 'propose' },
      { sourceId, field: 'attributes.serial', policy: 'source_wins' },
    ];
    expect(policyFor(rules, 'attributes.serial', sourceId)).toBe('source_wins');
    expect(policyFor(rules, 'attributes.serial', 'other')).toBe('propose');
  });
});

describe('reconcile', () => {
  const current = { name: 'LAP-042', criticality: 'high', 'attributes.serial': 'SN-OLD' };

  it('shows what a field is now alongside what the feed says', () => {
    const verdict = reconcile(current, { name: 'LAP-042-new', 'attributes.serial': 'SN-9' }, noRules, sourceId);
    expect(verdict.apply).toEqual({});
    expect(verdict.propose.map((change) => change.field).sort()).toEqual(['attributes.serial', 'name']);
    // Both sides travel with the proposal: a person cannot judge a change they
    // cannot see the current value of.
    const serial = verdict.propose.find((change) => change.field === 'attributes.serial')!;
    expect(serial.from).toBe('SN-OLD');
    expect(serial.to).toBe('SN-9');
  });

  it('writes a field a rule says the source owns', () => {
    const rules: Rule[] = [{ sourceId, field: 'attributes.serial', policy: 'source_wins' }];
    const verdict = reconcile(current, { 'attributes.serial': 'SN-9' }, rules, sourceId);
    expect(verdict.apply).toEqual({ 'attributes.serial': 'SN-9' });
    expect(verdict.propose).toEqual([]);
  });

  it('leaves an ignored field alone and says it did', () => {
    const rules: Rule[] = [{ sourceId: null, field: 'criticality', policy: 'ignore' }];
    const verdict = reconcile(current, { criticality: 'low' }, rules, sourceId);
    expect(verdict.apply).toEqual({});
    expect(verdict.propose).toEqual([]);
    // Counted rather than dropped, so the numbers in a run report add up.
    expect(verdict.ignored).toEqual(['criticality']);
  });

  it('treats a field the feed did not send as silence, not as a blanking', () => {
    // The trap that matters most. A source that stops sending a column — a
    // permission lost, an API version bumped — would otherwise look like every
    // device losing its serial at once, and under source_wins it would blank
    // them.
    const rules: Rule[] = [{ sourceId: null, field: 'attributes.serial', policy: 'source_wins' }];
    const verdict = reconcile(current, { name: 'LAP-042' }, rules, sourceId);
    expect(verdict.apply).toEqual({});
    expect(verdict.propose).toEqual([]);
  });

  it('treats an empty value as silence too', () => {
    const rules: Rule[] = [{ sourceId: null, field: 'attributes.serial', policy: 'source_wins' }];
    expect(reconcile(current, { 'attributes.serial': '' }, rules, sourceId).apply).toEqual({});
  });

  it('counts agreement rather than proposing it', () => {
    const verdict = reconcile(current, { name: 'LAP-042' }, noRules, sourceId);
    expect(verdict.unchanged).toEqual(['name']);
    expect(agrees(verdict)).toBe(true);
  });

  it('does not treat a number and its text as the same value', () => {
    // `8` and `"8"` disagreeing is the point: coercion here would undo the
    // refusal `checkAttributes` exists to make.
    const verdict = reconcile({ 'attributes.cpuCount': 8 }, { 'attributes.cpuCount': '8' }, noRules, sourceId);
    expect(verdict.propose).toHaveLength(1);
  });

  it('compares lists and objects by value, so a reordered feed is not a change', () => {
    const verdict = reconcile({ 'attributes.tags': ['a', 'b'] }, { 'attributes.tags': ['a', 'b'] }, noRules, sourceId);
    expect(verdict.unchanged).toEqual(['attributes.tags']);
  });

  it('does not call an object changed because JSONB handed back its keys in another order', () => {
    const verdict = reconcile(
      { 'attributes.spec': { cores: 8, ram: 32 } },
      { 'attributes.spec': { ram: 32, cores: 8 } },
      noRules,
      sourceId,
    );
    expect(verdict.propose).toEqual([]);
    expect(verdict.unchanged).toEqual(['attributes.spec']);
  });
});

describe('fingerprint', () => {
  /**
   * PostgreSQL JSONB does not preserve key order. A proposal written as
   * `{name, serial}` comes back in JSONB's own order, so comparing the two raw
   * `JSON.stringify` strings says "different" every time — which turns "has
   * somebody already rejected this?" into "no" for ever, and the rejected
   * proposal returns every single run.
   */
  it('is the same however the keys were ordered', () => {
    expect(fingerprint({ name: 'a', serial: 'b' })).toBe(fingerprint({ serial: 'b', name: 'a' }));
  });

  it('sorts nested objects and objects inside lists too', () => {
    expect(fingerprint({ a: { x: 1, y: 2 }, list: [{ p: 1, q: 2 }] })).toBe(
      fingerprint({ list: [{ q: 2, p: 1 }], a: { y: 2, x: 1 } }),
    );
  });

  it('keeps list order, which is information', () => {
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });

  it('still tells different values apart', () => {
    expect(fingerprint({ serial: 'SN-1' })).not.toBe(fingerprint({ serial: 'SN-2' }));
    expect(fingerprint({ cpuCount: 8 })).not.toBe(fingerprint({ cpuCount: '8' }));
  });
});

describe('flatten and unflatten', () => {
  it('namespaces attributes so one called name cannot collide with the name', () => {
    const flat = flatten({ name: 'LAP-042' }, { name: 'something else' });
    expect(flat).toEqual({ name: 'LAP-042', 'attributes.name': 'something else' });
  });

  it('round-trips', () => {
    const flat = flatten({ name: 'a', criticality: 'high' }, { serial: 'SN-1', cpuCount: 8 });
    expect(unflatten(flat)).toEqual({
      fields: { name: 'a', criticality: 'high' },
      attributes: { serial: 'SN-1', cpuCount: 8 },
    });
  });
});
