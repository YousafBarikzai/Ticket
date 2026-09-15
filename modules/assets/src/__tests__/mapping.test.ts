import { describe, expect, it } from 'vitest';
import { isMapped, mapRecord, mappingSchema, recordsFrom, valueAt, type Mapping } from '../domain/mapping.js';
import { presetFor } from '../sources/presets.js';

/**
 * Every feed calls things something different, so the mapping is configuration.
 * What must not be configurable is the behaviour when a record does not fit:
 * one unreadable row reports itself and the other three hundred and
 * ninety-nine import.
 */

const mapping: Mapping = mappingSchema.parse({
  classKey: 'device',
  externalKeyFrom: 'id',
  nameFrom: 'deviceName',
  fields: { status: 'complianceState' },
  attributes: { serial: 'hardware.serialNumber', cpuCount: 'hardware.cpus' },
  constants: { managed: true },
});

describe('valueAt', () => {
  it('walks a dotted path', () => {
    expect(valueAt({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
  });

  it('indexes an array both ways round, because feeds are written by people', () => {
    const record = { owners: [{ id: 'x' }, { id: 'y' }] };
    expect(valueAt(record, 'owners[1].id')).toBe('y');
    expect(valueAt(record, 'owners.1.id')).toBe('y');
  });

  it('gives undefined for something missing rather than throwing', () => {
    // A feed that omits an optional field for one device in four hundred is
    // ordinary; the caller decides whether that absence matters.
    expect(valueAt({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(valueAt(null, 'a')).toBeUndefined();
  });
});

describe('mapRecord', () => {
  it('maps a record that fits', () => {
    const result = mapRecord(mapping, {
      id: 'intune-1',
      deviceName: 'LAP-042',
      complianceState: 'compliant',
      hardware: { serialNumber: 'SN-9', cpus: 8 },
    });
    expect(isMapped(result)).toBe(true);
    if (!isMapped(result)) return;
    expect(result.externalKey).toBe('intune-1');
    expect(result.name).toBe('LAP-042');
    expect(result.fields.status).toBe('compliant');
    // The attribute keeps its type: the class declares what it is, and
    // `checkAttributes` is where a mismatch is caught.
    expect(result.attributes).toEqual({ serial: 'SN-9', cpuCount: 8, managed: true });
  });

  it('refuses a record with nothing to match on', () => {
    // Without a stable identifier the next run creates it again, and the run
    // after that, until the register is a list of duplicates.
    const result = mapRecord(mapping, { deviceName: 'LAP-042' });
    expect(isMapped(result)).toBe(false);
    expect(result.problems.join(' ')).toMatch(/nothing to match this record on/);
  });

  it('reports the name and the key together rather than one at a time', () => {
    const result = mapRecord(mapping, { hardware: {} });
    expect(result.problems).toHaveLength(2);
  });

  it('treats an empty string as absent', () => {
    expect(isMapped(mapRecord(mapping, { id: '   ', deviceName: 'x' }))).toBe(false);
  });

  it('leaves out an optional field the feed did not send, rather than blanking it', () => {
    // The trap that matters: absence is silence, not an instruction to clear.
    const result = mapRecord(mapping, { id: 'a', deviceName: 'b' });
    expect(isMapped(result)).toBe(true);
    if (!isMapped(result)) return;
    expect(result.fields).toEqual({});
    expect(result.attributes).toEqual({ managed: true });
  });

  it('reads a class from the record when the mapping says to', () => {
    const perRecord = mappingSchema.parse({
      classFrom: 'kind',
      classKey: 'cloud_resource',
      externalKeyFrom: 'arn',
      nameFrom: 'arn',
    });
    const result = mapRecord(perRecord, { arn: 'arn:1', kind: 'database' });
    expect(isMapped(result) && result.classKey).toBe('database');
  });

  it('falls back to the fixed class when the record does not say', () => {
    const perRecord = mappingSchema.parse({
      classFrom: 'kind',
      classKey: 'cloud_resource',
      externalKeyFrom: 'arn',
      nameFrom: 'arn',
    });
    const result = mapRecord(perRecord, { arn: 'arn:1' });
    expect(isMapped(result) && result.classKey).toBe('cloud_resource');
  });

  it('collects relationships and drops a record pointing at itself', () => {
    const withEdges = mappingSchema.parse({
      classKey: 'cloud_resource',
      externalKeyFrom: 'arn',
      nameFrom: 'name',
      relationships: [{ type: 'runs_on', from: 'runsOn' }],
    });
    const result = mapRecord(withEdges, { arn: 'a', name: 'a', runsOn: ['b', 'a', ''] });
    expect(isMapped(result) && result.relationships).toEqual([
      { type: 'runs_on', externalKey: 'b', direction: 'outgoing' },
    ]);
  });

  it('refuses a mapping that says nothing about which class records become', () => {
    expect(mappingSchema.safeParse({ externalKeyFrom: 'id', nameFrom: 'name' }).success).toBe(false);
  });
});

describe('recordsFrom', () => {
  it('finds the records where the feed puts them', () => {
    expect(recordsFrom({ value: [1, 2] }, 'value')).toEqual([1, 2]);
    expect(recordsFrom([1, 2])).toEqual([1, 2]);
  });

  it('treats a missing path as nothing found, not as an error', () => {
    // A feed with no results returns no results; an empty page is not a fault.
    expect(recordsFrom({ value: null }, 'value')).toEqual([]);
  });

  it('says so when the path is not a list', () => {
    expect(() => recordsFrom({ value: { id: 1 } }, 'value')).toThrow(/not a list of records/);
  });
});

describe('the built-in presets', () => {
  it('give every preset a usable mapping', () => {
    for (const kind of ['intune', 'azure', 'aws'] as const) {
      const preset = presetFor(kind);
      expect(mappingSchema.safeParse(preset.mapping).success).toBe(true);
    }
  });

  it('matches Intune on its own id rather than the serial', () => {
    // A device re-imaged and re-enrolled keeps the serial and gets a new id.
    // Matching on a serial a manufacturer reused merges two machines, and
    // nobody notices.
    expect(presetFor('intune').mapping?.externalKeyFrom).toBe('id');
  });

  it('leaves the generic kinds without a mapping, so one must be configured', () => {
    expect(presetFor('http_json').mapping).toBeUndefined();
    expect(presetFor('csv').mapping).toBeUndefined();
  });
});
