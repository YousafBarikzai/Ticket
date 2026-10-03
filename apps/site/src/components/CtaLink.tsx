import type { ReactNode } from 'react';
import { Icon, type IconName } from '@itsm/ui';

export interface CtaLinkProps {
  readonly href: string;
  readonly children: ReactNode;
  /** `primary`: the brand gradient, the one thing to press. `ghost`: a quiet outline on navy. */
  readonly variant?: 'primary' | 'ghost';
  /** `lg` 52 px (the hero), `sm` 36 px (the header). */
  readonly size?: 'sm' | 'lg';
  /** A glyph before the label ("log-in" on Sign in). */
  readonly icon?: IconName;
  /** The trailing arrow that nudges on hover; on by default for `primary`. */
  readonly arrow?: boolean;
  /** A role link into the demo: `rel="nofollow"` and `data-persona`, which the continue hint listens for. */
  readonly persona?: string;
  /** When the visible label is not the whole story ("Try the demo — explore the Service Desk as Alex Morgan"). */
  readonly label?: string;
  readonly className?: string;
}

/**
 * The landing's call-to-action link (A5 §4.2, §4.3).
 *
 * Always a plain `<a>`: every way into the product crosses to another origin,
 * where `next/link` would add client code and could prefetch a sign-in, and a
 * form would be refused by the site's `form-action 'self'`. A role link
 * carries `rel="nofollow"` and **never** `noreferrer` — the app's `/demo`
 * page opens the demo in one click only when the Referer names this site
 * (D22) — and no `target`, so the visitor stays in one tab.
 */
export function CtaLink({ href, children, variant = 'primary', size = 'lg', icon, arrow = variant === 'primary', persona, label, className }: CtaLinkProps): ReactNode {
  return (
    <a
      href={href}
      className={['app-Cta', `app-Cta--${variant}`, `app-Cta--${size}`, className].filter(Boolean).join(' ')}
      {...(persona ? { rel: 'nofollow', 'data-persona': persona } : {})}
      {...(label ? { 'aria-label': label } : {})}
    >
      {icon ? <Icon name={icon} size={size === 'lg' ? 18 : 16} /> : null}
      <span className="app-Cta__label">{children}</span>
      {arrow ? <Icon name="arrow-right" size={size === 'lg' ? 18 : 16} className="app-Cta__arrow" directional /> : null}
    </a>
  );
}
