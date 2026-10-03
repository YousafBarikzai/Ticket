import { DEMO_COOKIE, LAST_PATH_COOKIE, RETRY_COOKIE, SESSION_COOKIE } from '@itsm/bff/cookies';
import { DEMO_LOCAL_KEYS } from '@itsm/contracts/demo';
import { describe, expect, it } from 'vitest';
import { LAST_VIEW_COOKIE } from '../../../workbench/src/inbox/views.js';
import { CONTINUE_KEY } from '../client/continue-read.js';
import { PRODUCT_COOKIES, cookiesDocument } from '../legal/cookies.js';
import type { LegalDocument } from '../legal/types.js';

/**
 * The cookie policy names the cookies the product really sets (A5 §11.3).
 * The names come from the code that sets them, so renaming a cookie fails
 * here rather than leaving the policy wrong.
 */

function text(doc: LegalDocument): string {
  return doc.sections
    .flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.kind === 'p' ? [block.text] : block.kind === 'list' ? block.items : [block.caption, ...block.head, ...block.rows.flat()],
      ),
    ])
    .join('\n');
}

describe('/cookies', () => {
  const policy = text(cookiesDocument());

  it.each([
    ['session', SESSION_COOKIE],
    ['demo re-entry', DEMO_COOKIE],
    ['sign-in retry', RETRY_COOKIE],
    ['last path', LAST_PATH_COOKIE],
    ['last inbox view', LAST_VIEW_COOKIE],
  ])('lists the %s cookie by its real name', (_label, name) => {
    expect(Object.values(PRODUCT_COOKIES)).toContain(name);
    expect(policy).toContain(name);
  });

  it('includes __Host-itsm-last, the cross-area return cookie', () => {
    expect(policy).toContain('__Host-itsm-last');
  });

  it('lists the site’s one storage key and the demo notice keys', () => {
    expect(policy).toContain(CONTINUE_KEY);
    for (const key of Object.values(DEMO_LOCAL_KEYS)) expect(policy).toContain(key);
  });

  it('says the site itself sets no cookie', () => {
    expect(policy).toContain('This site sets no cookies.');
  });
});
