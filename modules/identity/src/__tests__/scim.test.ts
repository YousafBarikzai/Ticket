import { describe, expect, it } from 'vitest';
import { ScimError } from '../scim/errors.js';
import { parseFilter } from '../scim/filter.js';
import { asBoolean, memberIds, normalisePatch } from '../scim/patch.js';
import { fromScimGroup, fromScimUser, toScimUser } from '../scim/resources.js';
import { slugOf } from '../scim/token-service.js';

/**
 * SCIM as providers speak it, not as the RFC writes it. Each test names a
 * thing Entra ID or Okta actually sends, and what a server that read the RFC
 * too literally would do with it.
 */

describe('the filter a provider sends before it creates', () => {
  it('reads an equality on the attributes providers look up by', () => {
    expect(parseFilter('userName eq "ada@example.test"')).toEqual({ attribute: 'userName', value: 'ada@example.test' });
    expect(parseFilter('externalId eq "abc-123"')).toEqual({ attribute: 'externalId', value: 'abc-123' });
    expect(parseFilter('displayName eq "Service Desk"')).toEqual({ attribute: 'displayName', value: 'Service Desk' });
    expect(parseFilter('emails[type eq "work"].value eq "ada@example.test"')).toEqual({ attribute: 'emails.value', value: 'ada@example.test' });
  });

  it('is not case-sensitive about the attribute or the operator', () => {
    expect(parseFilter('UserName EQ "x@y.z"')).toEqual({ attribute: 'userName', value: 'x@y.z' });
  });

  it('refuses what it does not support rather than ignoring it', () => {
    // A filter the server quietly ignored would return every user, and the
    // provider would conclude the one it wants does not exist.
    expect(() => parseFilter('userName co "ada"')).toThrow(ScimError);
    expect(() => parseFilter('userName eq "a" and active eq true')).toThrow(/only "attribute eq/);
    expect(() => parseFilter('title eq "x"')).toThrow(/cannot be filtered on/);
  });

  it('treats no filter as no filter', () => {
    expect(parseFilter(undefined)).toBeNull();
    expect(parseFilter('  ')).toBeNull();
  });
});

describe('PATCH as Entra and Okta send it', () => {
  it('accepts a capitalised op and a string boolean', () => {
    const operations = normalisePatch({ Operations: [{ op: 'Replace', path: 'active', value: 'False' }] });
    expect(operations).toEqual([{ op: 'replace', path: 'active', value: 'False' }]);
    expect(asBoolean(operations[0]!.value)).toBe(false);
  });

  it('flattens a pathless replace into one operation per attribute', () => {
    const operations = normalisePatch({ Operations: [{ op: 'replace', value: { active: false, name: { givenName: 'Ada' }, displayName: 'Ada L' } }] });
    expect(operations).toEqual([
      { op: 'replace', path: 'active', value: false },
      { op: 'replace', path: 'name.givenName', value: 'Ada' },
      { op: 'replace', path: 'displayName', value: 'Ada L' },
    ]);
  });

  it('reads a member removal by selector and an addition by list', () => {
    const removal = normalisePatch({ Operations: [{ op: 'remove', path: 'members[value eq "11111111-1111-4111-8111-111111111111"]' }] })[0]!;
    expect(removal.path).toBe('members');
    expect(memberIds(removal)).toEqual(['11111111-1111-4111-8111-111111111111']);
    const addition = normalisePatch({ Operations: [{ op: 'add', path: 'members', value: [{ value: 'a' }, { value: 'b' }] }] })[0]!;
    expect(memberIds(addition)).toEqual(['a', 'b']);
  });

  it('strips the schema URN a path may be prefixed with', () => {
    const [operation] = normalisePatch({ Operations: [{ op: 'replace', path: 'urn:ietf:params:scim:schemas:core:2.0:User:userName', value: 'x@y.z' }] });
    expect(operation!.path).toBe('userName');
  });

  it('refuses an unknown op, a remove without a path and a path it cannot patch', () => {
    expect(() => normalisePatch({ Operations: [{ op: 'upsert', path: 'active', value: true }] })).toThrow(/unknown op/);
    expect(() => normalisePatch({ Operations: [{ op: 'remove' }] })).toThrow(/needs a path/);
    expect(() => normalisePatch({ Operations: [{ op: 'replace', path: 'password', value: 'x' }] })).toThrow(/cannot be patched/);
    expect(() => normalisePatch({})).toThrow(/Operations/);
  });
});

describe('a user as a resource', () => {
  it('takes the login name as the email, and a display name from whatever the provider filled in', () => {
    const input = fromScimUser({ userName: 'Ada@Example.test', name: { givenName: 'Ada', familyName: 'Lovelace' }, externalId: 'obj-1', active: 'True' });
    expect(input).toEqual({ userName: 'ada@example.test', externalId: 'obj-1', displayName: 'Ada Lovelace', active: true, locale: null, timeZone: null });
  });

  it('prefers the primary email over a userName that is not an address', () => {
    const input = fromScimUser({ userName: 'ada.l', emails: [{ value: 'other@example.test' }, { value: 'ada@example.test', primary: true }] });
    expect(input.userName).toBe('ada@example.test');
  });

  it('refuses a user with no address to sign in by', () => {
    expect(() => fromScimUser({ userName: 'ada.l' })).toThrow(/email address/);
    expect(() => fromScimUser({})).toThrow(/userName is required/);
  });

  it('renders a user with their groups and a location', () => {
    const now = new Date('2026-09-15T10:00:00Z');
    const resource = toScimUser(
      { id: 'u1', email: 'ada@example.test', displayName: 'Ada Lovelace', status: 'inactive', scimExternalId: 'obj-1', locale: 'en-GB', timeZone: 'Europe/London', createdAt: now, updatedAt: now },
      [{ id: 't1', name: 'Service Desk' }],
      (path) => `https://api.example${path}`,
    );
    expect(resource.active).toBe(false);
    expect(resource.name).toEqual({ formatted: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace' });
    expect(resource.groups).toEqual([{ value: 't1', display: 'Service Desk', $ref: 'https://api.example/Groups/t1' }]);
    expect(resource.meta.location).toBe('https://api.example/Users/u1');
  });

  it('reads a group with its members', () => {
    expect(fromScimGroup({ displayName: 'Service Desk', members: [{ value: 'a' }, { display: 'no value' }] })).toEqual({ displayName: 'Service Desk', externalId: null, memberIds: ['a'] });
    expect(() => fromScimGroup({})).toThrow(/displayName/);
  });
});

describe('the token', () => {
  it('names its tenant, and nothing else is a SCIM token', () => {
    expect(slugOf('scim_acme_' + 'a'.repeat(43))).toBe('acme');
    expect(slugOf('scim_acme-uk_' + 'b'.repeat(43))).toBe('acme-uk');
    expect(slugOf('Bearer x')).toBeNull();
    expect(slugOf('scim_acme_short')).toBeNull();
    expect(slugOf('scim__' + 'a'.repeat(43))).toBeNull();
  });
});
