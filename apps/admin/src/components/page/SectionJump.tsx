import type { ReactNode } from 'react';
import './page.css';

export interface SectionJumpProps {
  /** The page's sections in order: the `id` of each target and its short name ("Pulse", "SLA"). */
  readonly items: readonly { readonly id: string; readonly label: string }[];
}

/**
 * "On this page" chips for a dashboard on a phone (G12, A7 §2.7): a row of
 * anchor links under the top bar, shown below 48rem, so a long page of cards
 * is one tap from any section. Plain links, so it costs no JavaScript and
 * works before the page has loaded; each target carries
 * `scroll-margin-block-start` (in `page.css`) so it lands under the frame.
 */
export function SectionJump({ items }: SectionJumpProps): ReactNode {
  if (items.length < 2) return null;
  return (
    <nav aria-label="On this page" className="app-SectionJump">
      <ul className="app-SectionJump__list">
        {items.map((item) => (
          <li key={item.id}>
            <a className="app-SectionJump__chip" href={`#${item.id}`}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
