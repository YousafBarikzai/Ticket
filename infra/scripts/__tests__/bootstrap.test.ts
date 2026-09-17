import { describe, expect, it } from 'vitest';
import { requestFrom } from '../bootstrap.js';

/**
 * A deployed environment's first tenant and first administrator.
 *
 * What is tested here is the part that decides whether to act at all, because
 * that is the part with two failure modes that both look like success: doing
 * nothing when it was asked to do something, and creating a tenant nobody
 * asked for. Everything past this point needs a database and belongs to the
 * integration suite.
 */

describe('what the environment asks for', () => {
  it('does nothing at all when no slug is set', () => {
    // The default, and deliberately so: a deploy that invents a tenant has made
    // a decision on the operator's behalf.
    expect(requestFrom({})).toBeNull();
    expect(requestFrom({ BOOTSTRAP_TENANT_SLUG: '   ' })).toBeNull();
  });

  it('refuses a tenant that would have no administrator', () => {
    // Sign-in provisions a first visitor just in time with no role at all, so a
    // tenant whose only account is the next person to find the URL is not a
    // useful thing to have created. Louder than defaulting to somebody.
    expect(() => requestFrom({ BOOTSTRAP_TENANT_SLUG: 'acme' })).toThrow(/BOOTSTRAP_ADMIN_EMAIL is not; the tenant would have no administrator/);
    expect(() => requestFrom({ BOOTSTRAP_TENANT_SLUG: 'acme', BOOTSTRAP_ADMIN_EMAIL: 'nobody' })).toThrow(/not an email address/);
  });

  it('fills in what it can and leaves the rest alone', () => {
    expect(requestFrom({ BOOTSTRAP_TENANT_SLUG: 'acme', BOOTSTRAP_ADMIN_EMAIL: 'Someone@Example.com' })).toEqual({
      slug: 'acme',
      // The slug stands in for a name nobody supplied, rather than a tenant
      // called `undefined` appearing in the header of every page.
      name: 'acme',
      region: 'eu-west',
      adminEmail: 'someone@example.com',
      adminName: 'someone@example.com',
    });
  });

  it('lower-cases the address, because that is how the account is found again', () => {
    // The identity provider's first token links by address, and the link is
    // `where: { email }` against a column written in whatever case a person
    // typed into a Railway variable box.
    const request = requestFrom({ BOOTSTRAP_TENANT_SLUG: 'acme', BOOTSTRAP_ADMIN_EMAIL: '  ADMIN@Acme.CO.UK ' })!;
    expect(request.adminEmail).toBe('admin@acme.co.uk');
  });

  it('takes the name, region and display name when they are given', () => {
    expect(
      requestFrom({
        BOOTSTRAP_TENANT_SLUG: ' acme ',
        BOOTSTRAP_TENANT_NAME: 'Acme Ltd',
        BOOTSTRAP_TENANT_REGION: 'eu-central',
        BOOTSTRAP_ADMIN_EMAIL: 'admin@acme.co.uk',
        BOOTSTRAP_ADMIN_NAME: 'Acme Administrator',
      }),
    ).toEqual({
      slug: 'acme',
      name: 'Acme Ltd',
      region: 'eu-central',
      adminEmail: 'admin@acme.co.uk',
      adminName: 'Acme Administrator',
    });
  });
});
