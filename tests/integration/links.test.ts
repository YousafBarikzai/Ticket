import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { UNSAFE_LINK_MESSAGE, findUnsafeLinks, isSafeHref } from '@itsm/contracts/links';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * Links are `https:` or `mailto:`, in every tenant (D23, SPEC §4.7.5; A3 §11.2
 * row 22).
 *
 * Six fields hold a link somebody else will follow: a knowledge article's
 * body, a form's instructions, the status page's support link, a major
 * incident's bridge link, and a supplier's support link and a contract's
 * document link. Before v3 each took whatever `z.string().url()` took, which
 * includes `javascript:` — and the status page is rendered by the API's own
 * string template, so a support link there was stored script on the API's
 * origin for every visitor.
 *
 * This runs in a **standard** tenant on purpose: the rule is not a demo
 * restriction. Each unsafe value is sent to each field through the whole
 * plugin chain and must come back 422 with a field error at the link's own
 * path; afterwards nothing unsafe is in the database, and the safe links
 * written alongside are still there.
 */

const SLUG = 'links-d23';
let tenant: TestTenant;

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;

/** The field error an author sees; the canonical sentence, written out so a change to it is a decision. */
const MESSAGE = 'Links must start with https:// or mailto:';

const SAFE_SUPPORT = 'https://help.example.com/status';
const SAFE_SUPPLIER = 'https://support.northwind.example/';

/** A3 §11.1's refusals, plus the forms a person reading the link would misjudge. */
const UNSAFE: readonly (readonly [string, string])[] = [
  ['javascript:', 'javascript:alert(document.cookie)'],
  ['JAVASCRIPT:', 'JAVASCRIPT:alert(1)'],
  ['java<tab>script:', 'java\tscript:alert(1)'],
  ['<NUL>javascript:', '\u0000javascript:alert(1)'],
  ['a leading space', ' https://example.com/help'],
  ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
  ['vbscript:', 'vbscript:msgbox(1)'],
  ['http:', 'http://intranet.example/help'],
  ['protocol-relative', '//evil.example/help'],
  ['relative', '/knowledge/vpn'],
  ['https: without //', 'https:evil.example'],
  ['a user name before the host', 'https://bank.example@evil.example/'],
  ['2,049 characters', `https://example.com/${'a'.repeat(2049 - 'https://example.com/'.length)}`],
];

interface FieldError {
  field: string;
  code: string;
  message: string;
}

interface Answer {
  status: number;
  body: { errors?: FieldError[]; detail?: string };
}

const paragraphWith = (href: string) => ({ type: 'paragraph', content: [{ text: 'Read ' }, { text: 'the guide', href }] });

/** A form with one question and an instruction carrying `href`, optionally inside a section. */
function formDocument(key: string, href: string, inSection = false) {
  const instruction = { kind: 'instruction', id: 'intro', intent: 'info', content: [paragraphWith(href)] };
  return {
    key,
    schema: { type: 'object', properties: { reason: { type: 'string' } } },
    ui: {
      elements: inSection
        ? [{ kind: 'section', id: 'about', title: 'About this request', elements: [instruction] }, { kind: 'field', field: 'reason', control: 'text' }]
        : [{ kind: 'field', field: 'reason', control: 'text' }, instruction],
    },
  };
}

interface Field {
  /** What the row is called in the test name. */
  readonly name: string;
  /** Where the field error must point. */
  readonly path: string;
  readonly send: (href: string, n: number) => Promise<Answer>;
}

/**
 * One row per way a link reaches storage. Knowledge bodies and form
 * instructions are written by two routes each (create and edit), so both are
 * here; the counter keeps keys unique, so a refusal is never a conflict.
 */
const FIELDS: readonly Field[] = [
  {
    name: 'knowledge body, on create',
    path: 'body.0.content.1.href',
    send: (href, n) =>
      request('/api/v1/knowledge', {
        method: 'POST',
        token: asAdmin(),
        body: { key: `unsafe-article-${n}`, title: 'Resetting your VPN', body: [paragraphWith(href)], audience: 'tenant' },
      }),
  },
  {
    name: 'knowledge body, on a draft edit',
    path: 'body.1.items.0.1.href',
    send: (href) =>
      request('/api/v1/knowledge/safe-article', {
        method: 'PATCH',
        token: asAdmin(),
        body: {
          body: [paragraphWith('https://help.example.com/vpn'), { type: 'list', items: [[{ text: 'Then ' }, { text: 'renew', href }]] }],
          changeNote: 'Added a step',
        },
      }),
  },
  {
    name: 'form instructions, on create',
    path: 'document.ui.elements.1.content.0.content.1.href',
    send: (href, n) =>
      request('/api/v1/forms', {
        method: 'POST',
        token: asAdmin(),
        body: { key: `unsafe-form-${n}`, name: 'New laptop', document: formDocument(`unsafe-form-${n}`, href) },
      }),
  },
  {
    name: 'form instructions in a section, on edit',
    path: 'document.ui.elements.0.elements.0.content.0.content.1.href',
    send: (href) =>
      request('/api/v1/forms/safe-form', {
        method: 'PATCH',
        token: asAdmin(),
        body: { document: formDocument('safe-form', href, true) },
      }),
  },
  {
    name: 'status page support link',
    path: 'supportUrl',
    send: (href) =>
      request('/api/v1/status-page', { method: 'PATCH', token: asAdmin(), body: { name: 'Links status', supportUrl: href } }),
  },
  {
    name: 'major incident bridge link',
    path: 'bridgeUrl',
    send: (href, n) =>
      request('/api/v1/major-incidents', {
        method: 'POST',
        token: asLead(),
        body: { title: `Email is down ${n}`, severity: 'SEV2', commanderId: tenant.people.lead!.id, bridgeUrl: href },
      }),
  },
  {
    name: 'supplier support link',
    path: 'supportUrl',
    send: (href, n) => request('/api/v1/suppliers', { method: 'POST', token: asAdmin(), body: { name: `Unsafe supplier ${n}`, supportUrl: href } }),
  },
  {
    name: 'contract document link',
    path: 'documentUrl',
    send: (href, n) =>
      request('/api/v1/contracts', {
        method: 'POST',
        token: asAdmin(),
        body: {
          supplierName: 'Northwind Supplies',
          reference: `UNSAFE-${n}`,
          name: 'Laptop support',
          startsOn: '2026-01-01',
          endsOn: '2027-12-31',
          documentUrl: href,
        },
      }),
  },
];

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = contextFor(tenant.id);
  return withContext(context, () => transaction(context, fn));
}

beforeAll(async () => {
  tenant = await createTestTenant(SLUG);
}, 120_000);

afterAll(async () => {
  await deleteTestTenant(SLUG);
  await closeHarness();
});

describe('the rule and its sentence', () => {
  it('is the canonical sentence, from the one place both halves read it', () => {
    expect(UNSAFE_LINK_MESSAGE).toBe(MESSAGE);
    for (const [, href] of UNSAFE) expect(isSafeHref(href)).toBe(false);
  });
});

describe('safe links are written as before', () => {
  it('takes https: and mailto: in a knowledge body', async () => {
    const created = await request<{ key: string }>('/api/v1/knowledge', {
      method: 'POST',
      token: asAdmin(),
      body: {
        key: 'safe-article',
        title: 'Resetting your VPN',
        body: [
          paragraphWith('https://help.example.com/vpn'),
          { type: 'list', items: [[{ text: 'Write to ' }, { text: 'the desk', href: 'mailto:servicedesk@example.com' }]] },
        ],
        audience: 'tenant',
      },
    });
    expect(created.status).toBe(201);

    const edited = await request('/api/v1/knowledge/safe-article', {
      method: 'PATCH',
      token: asAdmin(),
      body: { body: [paragraphWith('https://help.example.com/vpn-v2')], changeNote: 'Newer guide' },
    });
    expect(edited.status).toBe(200);
  });

  it('takes an https: link in form instructions, top level and inside a section', async () => {
    const created = await request('/api/v1/forms', {
      method: 'POST',
      token: asAdmin(),
      body: { key: 'safe-form', name: 'New laptop', document: formDocument('safe-form', 'https://help.example.com/laptops') },
    });
    expect(created.status).toBe(201);

    const edited = await request('/api/v1/forms/safe-form', {
      method: 'PATCH',
      token: asAdmin(),
      body: { document: formDocument('safe-form', 'mailto:laptops@example.com', true) },
    });
    expect(edited.status).toBe(200);
  });

  it('takes an https: support link and renders it on the public page', async () => {
    const saved = await request<{ supportUrl: string | null }>('/api/v1/status-page', {
      method: 'PATCH',
      token: asAdmin(),
      body: { name: 'Links status', isPublic: true, supportUrl: SAFE_SUPPORT },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.supportUrl).toBe(SAFE_SUPPORT);

    const mail = await request<{ supportUrl: string | null }>('/api/v1/status-page', {
      method: 'PATCH',
      token: asAdmin(),
      body: { name: 'Links status', supportUrl: 'mailto:status@example.com' },
    });
    expect(mail.status).toBe(200);

    const restored = await request('/api/v1/status-page', { method: 'PATCH', token: asAdmin(), body: { name: 'Links status', supportUrl: SAFE_SUPPORT } });
    expect(restored.status).toBe(200);

    const html = await request<string>(`/status/${tenant.slug}`, { headers: { accept: 'text/html' } });
    expect(html.status).toBe(200);
    expect(html.body).toContain(`href="${SAFE_SUPPORT}"`);
  });

  it('takes an https: bridge link on a major incident', async () => {
    const declared = await request<{ number: string }>('/api/v1/major-incidents', {
      method: 'POST',
      token: asLead(),
      body: { title: 'VPN sign-in failures', severity: 'SEV2', commanderId: tenant.people.lead!.id, bridgeUrl: 'https://meet.example.com/mi-bridge' },
    });
    expect(declared.status).toBe(201);
  });

  it('takes https: links on a supplier and a contract', async () => {
    const supplier = await request('/api/v1/suppliers', {
      method: 'POST',
      token: asAdmin(),
      body: { name: 'Northwind Supplies', supportUrl: SAFE_SUPPLIER },
    });
    expect(supplier.status).toBe(201);

    const contract = await request('/api/v1/contracts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        supplierName: 'Northwind Supplies',
        reference: 'SAFE-1',
        name: 'Laptop support',
        startsOn: '2026-01-01',
        endsOn: '2027-12-31',
        documentUrl: 'https://files.example.com/contracts/safe-1.pdf',
      },
    });
    expect(contract.status).toBe(201);
  });
});

describe('every other link is refused with a field error at its path', () => {
  let n = 0;
  const cases = FIELDS.flatMap((field) => UNSAFE.map(([label, href]) => [field.name, label, field, href] as const));

  it.each(cases)('%s refuses %s', async (_name, _label, field, href) => {
    n += 1;
    const answer = await field.send(href, n);
    expect(answer.status, JSON.stringify(answer.body)).toBe(422);
    const errors = answer.body.errors ?? [];
    expect(errors.length).toBeGreaterThan(0);
    // Exactly the link, and nothing else: an author is told which link, in
    // the canonical sentence, not that the request was malformed.
    for (const error of errors) expect(error).toMatchObject({ field: field.path, message: MESSAGE });
  });
});

describe('nothing unsafe was stored, and the safe links survive', () => {
  it('holds no unsafe link in any knowledge version, and keeps the safe draft', async () => {
    const versions = await read((tx) =>
      tx.knowledgeArticleVersion.findMany({ select: { body: true, article: { select: { key: true } } } }),
    );
    expect(versions.map((version) => version.article.key).every((key) => key === 'safe-article')).toBe(true);
    for (const version of versions) expect(findUnsafeLinks(version.body)).toEqual([]);
    expect(JSON.stringify(versions.map((version) => version.body))).toContain('https://help.example.com/vpn-v2');
  });

  it('holds no unsafe link in any form, and keeps the safe one', async () => {
    const forms = await read((tx) => tx.formDefinitionRecord.findMany({ select: { key: true, document: true } }));
    expect(forms.some((form) => form.key.startsWith('unsafe-form-'))).toBe(false);
    for (const form of forms) expect(findUnsafeLinks(form.document)).toEqual([]);
    const safe = forms.find((form) => form.key === 'safe-form');
    expect(JSON.stringify(safe?.document)).toContain('mailto:laptops@example.com');
  });

  it('keeps the safe support link, on the record and on the public page', async () => {
    const page = await read((tx) => tx.statusPage.findFirst({ select: { supportUrl: true } }));
    expect(page?.supportUrl).toBe(SAFE_SUPPORT);

    const html = await request<string>(`/status/${tenant.slug}`, { headers: { accept: 'text/html' } });
    expect(html.body).toContain(`href="${SAFE_SUPPORT}"`);
    expect(html.body.toLowerCase()).not.toMatch(/javascript:|vbscript:|data:text/);
  });

  it('declared no incident with an unsafe bridge link', async () => {
    const incidents = await read((tx) => tx.majorIncident.findMany({ select: { title: true, bridgeUrl: true } }));
    expect(incidents.map((incident) => incident.title)).toEqual(['VPN sign-in failures']);
    for (const incident of incidents) expect(incident.bridgeUrl === null || isSafeHref(incident.bridgeUrl)).toBe(true);
  });

  it('created no supplier or contract with an unsafe link', async () => {
    const suppliers = await read((tx) => tx.supplier.findMany({ select: { name: true, supportUrl: true } }));
    expect(suppliers).toEqual([{ name: 'Northwind Supplies', supportUrl: SAFE_SUPPLIER }]);

    const contracts = await read((tx) => tx.contract.findMany({ select: { reference: true, documentUrl: true } }));
    expect(contracts).toEqual([{ reference: 'SAFE-1', documentUrl: 'https://files.example.com/contracts/safe-1.pdf' }]);
  });
});
