'use client';

import type { ReactNode } from 'react';
import { asRichBlocks, Prose, RichText } from '@itsm/ui';

/**
 * An article's body in article typography (17/28 at a 68-character measure,
 * SPEC §4.6). `RichText` walks a closed set of node types and never touches
 * `dangerouslySetInnerHTML`: an article is data that reached us over the
 * wire, and one compromised author account must not become stored script for
 * everyone who reads it. A block it does not understand is left out and the
 * rest still reads.
 *
 * A client module only so that the page, a server component, does not name
 * `Prose` through the display group's entry (which would put every client
 * component of that group in the route's first load, WP14 §Issues 2); the
 * two components are a few hundred bytes here.
 */
export function ArticleBody({ body }: { readonly body: readonly unknown[] }): ReactNode {
  return (
    <Prose size="lg" className="app-Article__body">
      <RichText content={asRichBlocks(body)} />
    </Prose>
  );
}
