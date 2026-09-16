'use client';

import type { ReactNode } from 'react';
import type { RichBlock, RichInline } from '@itsm/contracts';
import { cx } from './cx.js';

/**
 * A structured document, rendered. Never an HTML string.
 *
 * Form instructions and knowledge articles are both authored by people inside
 * the tenant through governed builders, and "the author is trusted" is not a
 * security model: a stored document is still data that reached us over the
 * wire, and `dangerouslySetInnerHTML` would turn one compromised administrator
 * account into stored cross-site scripting for every requester who opens the
 * form — or, for an article, for everyone in the organisation.
 *
 * So the renderer walks a closed set of node types and emits elements. A node
 * shape it does not recognise renders as nothing rather than as its JSON,
 * which is the failure that leaks least.
 *
 * Extracted from `FormRenderer`, where it lived privately, when the portal
 * needed to render an article body: two renderers for one document format
 * would be two places for that guarantee to be weakened.
 */

export interface RichTextProps {
  readonly content: readonly RichBlock[];
  readonly className?: string;
}

function inline(run: RichInline, key: number): ReactNode {
  if ('href' in run) {
    // `rel` on every authored link: a document from the database may link
    // anywhere, and `noopener` is what stops the target reaching back through
    // `window.opener`.
    return (
      <a key={key} href={run.href} rel="noopener noreferrer">
        {run.text}
      </a>
    );
  }
  let node: ReactNode = run.text;
  if (run.code) node = <code>{node}</code>;
  if (run.italic) node = <em>{node}</em>;
  if (run.bold) node = <strong>{node}</strong>;
  return <span key={key}>{node}</span>;
}

export function RichText({ content, className }: RichTextProps): ReactNode {
  return (
    <div className={cx('itsm-RichText', className)}>
      {content.map((block, index) => {
        if (block.type === 'paragraph') return <p key={index}>{block.content.map(inline)}</p>;
        if (block.type === 'list') {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{item.map(inline)}</li>);
          return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
        }
        return null;
      })}
    </div>
  );
}

/**
 * Narrows a body that arrived as `unknown[]` — which is how the API types an
 * article's blocks — to the ones this renderer understands.
 *
 * Done here rather than at each call site because the interesting decision is
 * what to do with a block that does not fit: it is dropped, silently, and the
 * rest of the article still renders. The alternative, throwing, would make one
 * malformed block take down a page somebody needed.
 */
export function asRichBlocks(value: unknown): RichBlock[] {
  if (!Array.isArray(value)) return [];
  return value.filter((block): block is RichBlock => {
    if (!block || typeof block !== 'object') return false;
    const candidate = block as { type?: unknown; content?: unknown; items?: unknown };
    if (candidate.type === 'paragraph') return Array.isArray(candidate.content);
    if (candidate.type === 'list') return Array.isArray(candidate.items);
    return false;
  });
}
