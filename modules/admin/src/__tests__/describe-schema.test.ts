import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeSchema } from '../service/describe-schema.js';

/**
 * The descriptor is what the console draws a setting's control from, so each
 * case below is a control that would otherwise be wrong: a free text box for
 * a choice, a number field that accepts 0 for a threshold that must be above
 * it, a switch for something that is not a boolean.
 */

describe('describeSchema', () => {
  it('describes a choice with its options, in order', () => {
    expect(describeSchema(z.enum(['P1', 'P2', 'P3', 'P4']))).toEqual({ kind: 'enum', options: ['P1', 'P2', 'P3', 'P4'] });
  });

  it('treats a union of string literals, and a string native enum, as a choice', () => {
    expect(describeSchema(z.union([z.literal('a'), z.literal('b')]))).toEqual({ kind: 'enum', options: ['a', 'b'] });
    enum Mode {
      Off = 'off',
      On = 'on',
    }
    expect(describeSchema(z.nativeEnum(Mode))).toEqual({ kind: 'enum', options: ['off', 'on'] });
  });

  it('refuses to call a numeric native enum a list of options', () => {
    enum Level {
      Low,
      High,
    }
    expect(describeSchema(z.nativeEnum(Level))).toEqual({ kind: 'json' });
  });

  it('describes a whole number with its bounds', () => {
    expect(describeSchema(z.number().int().min(1).max(90))).toEqual({ kind: 'number', int: true, min: 1, max: 90 });
  });

  it('says when a bound itself is excluded', () => {
    // The AI thresholds: 0 would mean "always", which is not a threshold.
    expect(describeSchema(z.number().gt(0).max(1))).toEqual({ kind: 'number', int: false, min: 0, minExclusive: true, max: 1 });
    expect(describeSchema(z.number().positive().lt(10))).toEqual({ kind: 'number', int: false, min: 0, minExclusive: true, max: 10, maxExclusive: true });
  });

  it('keeps the tightest of several bounds', () => {
    expect(describeSchema(z.number().min(1).min(5).max(100).max(50))).toEqual({ kind: 'number', int: false, min: 5, max: 50 });
    // Meeting at the same value, the exclusive bound is the tighter one.
    expect(describeSchema(z.number().min(0).gt(0))).toEqual({ kind: 'number', int: false, min: 0, minExclusive: true });
  });

  it('describes a switch', () => {
    expect(describeSchema(z.boolean())).toEqual({ kind: 'boolean' });
  });

  it('describes text with its length bounds', () => {
    expect(describeSchema(z.string().min(2).max(40))).toEqual({ kind: 'string', min: 2, max: 40 });
    expect(describeSchema(z.string())).toEqual({ kind: 'string' });
    expect(describeSchema(z.string().length(3))).toEqual({ kind: 'string', min: 3, max: 3 });
  });

  it('sees through wrappers that change what may be omitted, not what a value is', () => {
    expect(describeSchema(z.number().int().optional())).toEqual({ kind: 'number', int: true });
    expect(describeSchema(z.boolean().nullable().default(false))).toEqual({ kind: 'boolean' });
    expect(describeSchema(z.string().max(5).refine((value) => value !== 'x'))).toEqual({ kind: 'string', max: 5 });
    expect(describeSchema(z.enum(['a']).catch('a').readonly())).toEqual({ kind: 'enum', options: ['a'] });
    expect(describeSchema(z.string().brand<'Key'>())).toEqual({ kind: 'string' });
    expect(describeSchema(z.string().pipe(z.string().min(1)))).toEqual({ kind: 'string' });
  });

  it('describes a structured value field by field', () => {
    // problem.recurrenceThreshold
    expect(
      describeSchema(z.object({ tickets: z.number().int().min(2).max(500), withinDays: z.number().int().min(1).max(365) })),
    ).toEqual({
      kind: 'object',
      fields: {
        tickets: { kind: 'number', int: true, min: 2, max: 500 },
        withinDays: { kind: 'number', int: true, min: 1, max: 365 },
      },
    });
  });

  it('describes a map, with its keys when they are a fixed set', () => {
    // incident.updateIntervalMinutes
    expect(describeSchema(z.record(z.enum(['SEV1', 'SEV2', 'SEV3']), z.number().int().min(5).max(1440)))).toEqual({
      kind: 'record',
      keys: ['SEV1', 'SEV2', 'SEV3'],
      value: { kind: 'number', int: true, min: 5, max: 1440 },
    });
    expect(describeSchema(z.record(z.string(), z.boolean()))).toEqual({ kind: 'record', value: { kind: 'boolean' } });
  });

  it('says json, and so read-only, for anything it cannot describe with certainty', () => {
    expect(describeSchema(z.array(z.string()))).toEqual({ kind: 'json' });
    expect(describeSchema(z.union([z.string(), z.number()]))).toEqual({ kind: 'json' });
    expect(describeSchema(z.literal(3))).toEqual({ kind: 'json' });
    expect(describeSchema(z.unknown())).toEqual({ kind: 'json' });
  });
});
