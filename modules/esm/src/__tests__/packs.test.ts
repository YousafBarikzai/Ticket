import { describe, expect, it } from 'vitest';
import { assertDocumentIsCoherent } from '@itsm/module-catalogue';
import { checkGraph, parseGraph } from '@itsm/module-workflow';
import { ALL_PACKS, packFor } from '../packs/index.js';
import { entriesOf, hashOf, packSchema, selectorOf } from '../domain/pack.js';

/**
 * A pack is content, and content in a repository rots quietly: a form whose
 * condition names a property somebody renamed still parses, still installs,
 * and is discovered by a requester who cannot submit it. So every shipped
 * pack is put through the same checks the modules apply at install, here, in
 * the unit suite that runs on every change.
 *
 * This is what "validated at build time" means for packs (ADR-0039). The
 * install path adds nothing these tests do not already cover; it just runs
 * later, against a tenant, where being wrong is expensive.
 */
describe('the packs this deployment ships', () => {
  it('ships the four desks, each with a service, a request, a workflow, an SLA and an article', () => {
    expect(ALL_PACKS.map((pack) => pack.key).sort()).toEqual(['facilities', 'finance', 'hr', 'legal']);
    for (const pack of ALL_PACKS) {
      expect(pack.services.length, pack.key).toBeGreaterThan(0);
      expect(pack.requestTypes.length, pack.key).toBeGreaterThan(0);
      expect(pack.workflows.length, pack.key).toBeGreaterThan(0);
      expect(pack.slaPolicies.length, pack.key).toBeGreaterThan(0);
      expect(pack.articles.length, pack.key).toBeGreaterThan(0);
      expect(pack.nextSteps.length, pack.key).toBeGreaterThan(0);
    }
  });

  it('parses against its own schema, with nothing extra in it', () => {
    for (const pack of ALL_PACKS) {
      expect(() => packSchema.parse(pack), pack.key).not.toThrow();
    }
  });

  it('names only things it also ships', () => {
    for (const pack of ALL_PACKS) {
      const services = new Set(pack.services.map((service) => service.key));
      const forms = new Set(pack.forms.map((form) => form.key));
      for (const item of pack.requestTypes) {
        expect(services.has(item.serviceKey), `${pack.key}: ${item.key} → service ${item.serviceKey}`).toBe(true);
        if (item.formKey) {
          expect(forms.has(item.formKey), `${pack.key}: ${item.key} → form ${item.formKey}`).toBe(true);
        }
      }
    }
  });

  it('ships forms that can actually be filled in', () => {
    for (const pack of ALL_PACKS) {
      for (const form of pack.forms) {
        expect(() => assertDocumentIsCoherent({ ...form.document, version: 1 } as never), `${pack.key}: ${form.key}`).not.toThrow();
      }
    }
  });

  it('ships workflows that would publish', () => {
    for (const pack of ALL_PACKS) {
      for (const workflow of pack.workflows) {
        const problems = checkGraph(parseGraph(workflow.graph));
        expect(problems, `${pack.key}: ${workflow.key} — ${problems.map((p) => p.message).join('; ')}`).toEqual([]);
      }
    }
  });

  it('never has two packs claiming the same key', () => {
    const seen = new Map<string, string>();
    for (const pack of ALL_PACKS) {
      for (const entry of entriesOf(pack)) {
        const selector = selectorOf(entry.kind, entry.key);
        const owner = seen.get(selector);
        expect(owner, `${selector} is in both ${owner} and ${pack.key}`).toBeUndefined();
        seen.set(selector, pack.key);
      }
    }
  });

  it('matches its SLA policy to a service it ships, by key rather than by identifier', () => {
    for (const pack of ALL_PACKS) {
      const services = pack.services.map((service) => service.key);
      for (const policy of pack.slaPolicies) {
        const match = JSON.stringify(policy.match);
        expect(match, `${pack.key}: ${policy.key}`).toContain('ticket.serviceKey');
        expect(services.some((key) => match.includes(`"${key}"`)), `${pack.key}: ${policy.key}`).toBe(true);
      }
    }
  });

  it('finds a pack by key, and nothing by a key it does not ship', () => {
    expect(packFor('hr')?.name).toBe('People services');
    expect(packFor('marketing')).toBeNull();
  });
});

describe('the hash a pack item is compared by', () => {
  it('does not depend on the order the definition was written in', () => {
    const one = hashOf('service', { key: 'hr', name: 'People services', description: 'Everything.' });
    const other = hashOf('service', { description: 'Everything.', name: 'People services', key: 'hr' });
    expect(one).toBe(other);
  });

  it('ignores the key, which is the identity rather than the content', () => {
    const one = hashOf('service', { key: 'hr', name: 'People services' });
    const other = hashOf('service', { key: 'people', name: 'People services' });
    expect(one).toBe(other);
  });

  it('treats an absent optional field and an explicit null as the same thing', () => {
    expect(hashOf('service', { name: 'Desk' })).toBe(hashOf('service', { name: 'Desk', description: null }));
  });

  it('applies the same defaults a request type would get from the catalogue', () => {
    const shipped = hashOf('request_type', { serviceKey: 'hr', name: 'Leave' });
    const stored = hashOf('request_type', {
      serviceKey: 'hr',
      name: 'Leave',
      description: null,
      shortSummary: null,
      formKey: null,
      entitlement: null,
      priority: 'P3',
      sortOrder: 100,
    });
    expect(shipped).toBe(stored);
  });

  it('ignores the key and version the form service writes into a stored document', () => {
    const document = { schema: { type: 'object', properties: {} }, ui: { elements: [] } };
    const shipped = hashOf('form', { name: 'Leave', document: { key: 'hr-leave', ...document } });
    const stored = hashOf('form', { name: 'Leave', document: { key: 'hr-leave', version: 4, ...document } });
    expect(shipped).toBe(stored);
  });

  it('does not depend on the order an SLA policy\u2019s targets were written in', () => {
    // The database hands targets back sorted by priority and type, and a pack
    // is written P1, P2, P3, P4. Without a shared order every shipped policy
    // would read as edited the moment anybody looked at it.
    const written = hashOf('sla_policy', {
      name: 'HR standard',
      targets: [
        { priority: 'P3', targetType: 'response', minutes: 480 },
        { priority: 'P3', targetType: 'fulfilment', minutes: 2400 },
      ],
    });
    const stored = hashOf('sla_policy', {
      name: 'HR standard',
      targets: [
        { priority: 'P3', targetType: 'fulfilment', minutes: 2400, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'response', minutes: 480, warningThresholds: [50, 75, 90] },
      ],
    });
    expect(written).toBe(stored);
  });

  it('notices a change anywhere in the content', () => {
    const before = hashOf('article', { title: 'Leave', body: [{ type: 'paragraph', content: [{ text: 'a' }] }] });
    const after = hashOf('article', { title: 'Leave', body: [{ type: 'paragraph', content: [{ text: 'b' }] }] });
    expect(before).not.toBe(after);
  });
});
