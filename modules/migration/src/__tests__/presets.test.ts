import { describe, expect, it } from 'vitest';
import { ENTITIES, parseMapping } from '../domain/mapping.js';
import { SOURCE_KINDS, describeSources, presetFor } from '../domain/presets.js';
import { resolveSource } from '../sources/fetch.js';

/**
 * A preset is a mapping with the boxes filled in, so the one thing worth
 * proving is that every box is filled correctly: each preset's mapping
 * passes its entity's checks, and each resolves to a URL on the instance
 * the tenant names.
 */

describe('the named adapters', () => {
  it('ship a mapping every entity accepts', () => {
    for (const kind of SOURCE_KINDS) {
      for (const entity of ENTITIES) {
        const preset = presetFor(kind, entity);
        if (!preset.mapping) continue;
        expect(() => parseMapping(entity, preset.mapping), `${kind} ${entity}`).not.toThrow();
      }
    }
  });

  it('cover users, teams, services and tickets for all three vendors', () => {
    for (const kind of ['servicenow', 'jira', 'freshservice'] as const) {
      for (const entity of ['users', 'teams', 'services', 'tickets'] as const) {
        expect(presetFor(kind, entity).path, `${kind} ${entity}`).toBeDefined();
      }
    }
  });

  it('resolve to a URL on the tenant\'s instance, with the tenant\'s overrides winning', () => {
    const resolved = resolveSource('servicenow', 'tickets', { baseUrl: 'https://acme.service-now.com/', credentialRef: 'snow' });
    expect(resolved.url).toMatch(/^https:\/\/acme\.service-now\.com\/api\/now\/table\/incident\?/);
    expect(resolved.paging).toMatchObject({ kind: 'offset', param: 'sysparm_offset' });
    expect(resolved.credentialHeader).toBe('authorization');

    const overridden = resolveSource('freshservice', 'users', { baseUrl: 'https://acme.freshservice.com', path: '/api/v2/agents', recordsPath: 'agents' });
    expect(overridden.url).toBe('https://acme.freshservice.com/api/v2/agents');
    expect(overridden.recordsPath).toBe('agents');
  });

  it('refuse a job that names no instance, and a csv job with no file', () => {
    expect(() => resolveSource('jira', 'users', {})).toThrow(/baseUrl/);
    expect(() => resolveSource('csv', 'users', {})).toThrow(/fileId/);
    expect(() => resolveSource('http_json', 'tickets', { baseUrl: 'https://x.example' })).toThrow(/no preset/);
  });

  it('describe themselves to an administrator', () => {
    const described = describeSources();
    const jira = described.find((source) => source.kind === 'jira')!;
    expect(jira.entities.map((entity) => entity.entity)).toEqual(expect.arrayContaining(['users', 'teams', 'services', 'tickets']));
    expect(jira.entities.find((entity) => entity.entity === 'tickets')!.mapping).not.toBeNull();
  });
});
