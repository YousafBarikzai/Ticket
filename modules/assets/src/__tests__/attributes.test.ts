import { describe, expect, it } from 'vitest';
import {
  assertAttributes,
  attributeListSchema,
  checkAttributes,
  inheritedAttributes,
  type AttributeDefinition,
} from '../domain/attributes.js';

/**
 * Class-declared attributes are the part of a CMDB that decays quietly. Nothing
 * fails when `cpuCount` is the string "eight"; the report that sums it just
 * comes out wrong, months later, and by then nobody can tell which of four
 * hundred rows to look at.
 */

const declared: AttributeDefinition[] = [
  { key: 'cpuCount', label: 'CPU count', type: 'number', required: true },
  { key: 'hostname', label: 'Hostname', type: 'string', required: false },
  { key: 'monitored', label: 'Monitored', type: 'boolean', required: false },
  { key: 'commissionedOn', label: 'Commissioned on', type: 'date', required: false },
  { key: 'tier', label: 'Tier', type: 'enum', required: false, options: ['gold', 'silver'] },
];

describe('checkAttributes', () => {
  it('accepts a row that matches its class', () => {
    expect(
      checkAttributes(declared, {
        cpuCount: 8,
        hostname: 'db-01',
        monitored: true,
        commissionedOn: '2024-03-01',
        tier: 'gold',
      }),
    ).toEqual([]);
  });

  it('refuses a number written as text rather than coercing it', () => {
    const problems = checkAttributes(declared, { cpuCount: '8' });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.key).toBe('cpuCount');
  });

  it('reports every problem in one pass, so an import is fixed once', () => {
    const problems = checkAttributes(declared, { hostname: 42, tier: 'bronze', cpus: 8 });
    // Missing required cpuCount, hostname of the wrong type, a value outside
    // the enum, and a key the class does not declare: four, not one.
    expect(problems.map((problem) => problem.key).sort()).toEqual(['cpuCount', 'cpus', 'hostname', 'tier']);
  });

  it('treats an empty string as absent, so a blank form field fails a required attribute', () => {
    expect(checkAttributes(declared, { cpuCount: '' })).toHaveLength(1);
  });

  it('refuses an attribute the class does not declare, because it is a typo', () => {
    const problems = checkAttributes(declared, { cpuCount: 8, cpus: 4 });
    expect(problems).toEqual([{ key: 'cpus', message: 'cpus is not an attribute of this class' }]);
  });

  it('raises a 422 naming each bad field', () => {
    try {
      assertAttributes(declared, { cpuCount: 'eight' });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as { status: number }).status).toBe(422);
      expect((error as { fieldErrors?: { field: string }[] }).fieldErrors?.[0]?.field).toBe('attributes.cpuCount');
    }
  });
});

describe('attributeListSchema', () => {
  it('refuses an enum with no options, which no value could ever satisfy', () => {
    const parsed = attributeListSchema.safeParse([{ key: 'tier', label: 'Tier', type: 'enum', required: true }]);
    expect(parsed.success).toBe(false);
  });

  it('refuses the same key declared twice', () => {
    const parsed = attributeListSchema.safeParse([
      { key: 'tier', label: 'Tier', type: 'string' },
      { key: 'tier', label: 'Service tier', type: 'string' },
    ]);
    expect(parsed.success).toBe(false);
  });
});

describe('inheritedAttributes', () => {
  const server = { attributes: [{ key: 'cpuCount', label: 'CPU count', type: 'number', required: false }] };
  const database = {
    attributes: [
      { key: 'cpuCount', label: 'CPU count', type: 'number', required: true },
      { key: 'engine', label: 'Engine', type: 'string', required: true },
    ],
  };

  it('merges the chain, most general first', () => {
    const merged = inheritedAttributes([server, database]);
    expect(merged.map((attribute) => attribute.key).sort()).toEqual(['cpuCount', 'engine']);
  });

  it('lets a subclass tighten what it inherits', () => {
    const merged = inheritedAttributes([server, database]);
    // Server declares cpuCount optional; Database Server requires it. The
    // specific one wins, or a subclass could never add a requirement.
    expect(merged.find((attribute) => attribute.key === 'cpuCount')?.required).toBe(true);
  });

  it('skips a level whose declaration is malformed rather than losing the rest', () => {
    const merged = inheritedAttributes([{ attributes: 'not a list' }, database]);
    expect(merged.map((attribute) => attribute.key).sort()).toEqual(['cpuCount', 'engine']);
  });
});
