import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@itsm/contracts/areas';
import { BrandMark, Icon } from '@itsm/ui';
import { HEADER } from '../landing/content.js';
import { CtaLink } from './CtaLink.js';

export interface SiteHeaderProps {
  /** The one-click entry as the agent (`demoHref(config, 'agent')`); null hides the CTA (demo off, or no Service Desk origin). */
  readonly ctaHref: string | null;
  /** Whether the "How the demo works" anchor has a section to go to (demo on). */
  readonly demo: boolean;
}

/**
 * The landing's sticky navy header (A5 §4.2, X-m3, X-M1).
 *
 * It sticks under the demo strip (`--itsm-system-bar-h`, published by the
 * strip itself) and the hero runs up under it. The lockup goes back to the
 * top; the anchors are "Features" and "How the demo works" (on wide screens
 * only, as the benchmark does: two anchors need no menu); "Sign in" goes to
 * the chooser. Once the hero has scrolled away a "Try the demo" button
 * appears that opens the Service Desk as the agent in one click — revealed by
 * a scroll timeline in CSS, so there is no script; a browser without scroll
 * timelines simply shows it all the time.
 */
export function SiteHeader({ ctaHref, demo }: SiteHeaderProps): ReactNode {
  return (
    <header className="app-SiteHeader" data-surface="hero">
      <div className="app-SiteHeader__inner app-Wrap">
        <a className="app-Lockup" href="#top" aria-label={HEADER.homeLabel}>
          <BrandMark size={32} />
          <span className="app-Lockup__text">
            <span className="app-Lockup__name itsm-text-lockup">{PRODUCT_NAME}</span>
            <span className="app-Lockup__by">{HEADER.by}</span>
          </span>
        </a>
        <nav className="app-SiteHeader__nav" aria-label={HEADER.navLabel}>
          <a className="app-SiteHeader__link" href="#explore">
            {HEADER.features}
          </a>
          {demo ? (
            <a className="app-SiteHeader__link" href="#how-it-works">
              {HEADER.howItWorks}
            </a>
          ) : null}
        </nav>
        <div className="app-SiteHeader__actions">
          <a className="app-SiteHeader__signIn" href="/sign-in">
            <Icon name="log-in" size={16} />
            {HEADER.signIn}
          </a>
          {ctaHref ? (
            <CtaLink href={ctaHref} size="sm" persona="agent" label={HEADER.ctaLabel} className="app-SiteHeader__cta">
              {HEADER.cta}
            </CtaLink>
          ) : null}
        </div>
      </div>
    </header>
  );
}
