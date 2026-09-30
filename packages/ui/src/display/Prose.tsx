import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';

export interface ProseProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly children: ReactNode;
  /**
   * `md` (default) sets reading text at the product's `body` size (15/24) —
   * a ticket's description, a form's instructions. `lg` is article typography,
   * 17/28 at a 68-character measure — a knowledge article.
   */
  readonly size?: 'md' | 'lg';
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * Long-form reading typography at a measure people can read. Server-safe.
 *
 * It styles plain elements — paragraphs, lists, headings, links, quotes,
 * code — so `RichText`, or any server-rendered markup, reads as an article
 * inside it with no classes of its own. `RichText` carries the same flow
 * rules at the size of whatever it sits in, so it also reads well outside
 * one.
 */
export function Prose({ children, size = 'md', className, ref, ...rest }: ProseProps): ReactNode {
  return (
    <div {...rest} ref={ref} className={cx('itsm-Prose', className)} data-size={size}>
      {children}
    </div>
  );
}
