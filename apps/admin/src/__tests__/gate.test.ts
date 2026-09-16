import { describe, expect, it } from 'vitest';
import { holds } from '../permissions.js';
import type { Me } from '@itsm/sdk';

/**
 * Who may reach the platform section.
 *
 * This console serves two audiences in one application, which was a decision
 * taken deliberately and is the arrangement with the sharper edge: a screen
 * that lists every tenant on the deployment is one permission check away from
 * a tenant administrator. So the check itself is worth a test of its own,
 * separate from the layout that calls it.
 *
 * The layout is where it is called, and that placement is the substance:
 * Next renders a segment's layout before any page inside it, so a route added
 * to `(platform)/` later is behind the gate by construction rather than by
 * somebody remembering. A per-page check is one page away from being
 * forgotten, and the page somebody forgets is the one that enumerates every
 * customer.
 *
 * None of this is the security boundary. The API refuses these calls without
 * `platform.tenant.manage` whatever the console does — no role in the shipped
 * role seed holds it. This is the console not offering what it cannot deliver.
 */

function person(permissions: string[]): Me {
  return {
    actor: { type: 'user', id: 'u-1', displayName: 'A Person' },
    tenant: { id: 't-1', name: 'Acme', slug: 'acme', region: 'eu-west' },
    permissions: permissions.map((key) => ({ key, scope: 'any' })),
    organisations: [],
    teamIds: [],
    locale: 'en-GB',
    timeZone: 'Europe/London',
  };
}

describe('holding a permission', () => {
  it('is true when it is granted', () => {
    expect(holds(person(['platform.tenant.manage']), 'platform.tenant.manage')).toBe(true);
  });

  it('is false for a tenant administrator, who has none of the platform permissions', () => {
    // The shipped role seed contains no `platform.*` permission at all, so
    // this is the real case rather than a contrived one.
    const administrator = person([
      'identity.user.manage',
      'ticket.config.manage',
      'admin.settings.manage',
      'identity.session.manage',
    ]);
    expect(holds(administrator, 'platform.tenant.manage')).toBe(false);
  });

  it('is false for somebody with no permissions at all', () => {
    expect(holds(person([]), 'platform.tenant.manage')).toBe(false);
  });

  it('does not match a prefix, so a narrower permission never opens a wider door', () => {
    // `platform.tenant.read` must not satisfy `platform.tenant.manage`, and
    // `platform` must not satisfy anything.
    expect(holds(person(['platform.tenant.read']), 'platform.tenant.manage')).toBe(false);
    expect(holds(person(['platform']), 'platform.tenant.manage')).toBe(false);
  });

  it('matches exactly, including case', () => {
    expect(holds(person(['Platform.Tenant.Manage']), 'platform.tenant.manage')).toBe(false);
  });
});
