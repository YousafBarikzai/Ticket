import type { ReactNode } from 'react';
import { Icon } from '@itsm/ui';
import { FOOTER } from '../landing/content.js';

export interface SiteFooterProps {
  /** The year in the copyright line; passed in so a render is a pure function of its inputs. */
  readonly year: number;
  readonly demo: boolean;
}

/**
 * The landing's footer (A5 §4.8): the lockup, the legal links, the
 * essential-storage line and the fine print — that the company and its
 * people are fictional, that third-party product names in fictional tickets
 * belong to their owners, and the vendor line (honesty rules H5, H8, H10).
 */
export function SiteFooter({ year, demo }: SiteFooterProps): ReactNode {
  return (
    <footer className="app-Footer">
      <div className="app-Wrap">
        <div className="app-Footer__top">
          <div className="app-Footer__brand">
            <p className="app-Footer__name">
              <span className="itsm-text-lockup">{FOOTER.name}</span> <span className="app-Footer__by">{FOOTER.by}</span>
            </p>
            <p className="app-Footer__copy">{demo ? FOOTER.copyright(year) : FOOTER.copyrightOff(year)}</p>
          </div>
          <nav className="app-Footer__nav" aria-label={FOOTER.navLabel}>
            {FOOTER.links.map((link) => (
              <a key={link.href} className="app-Footer__link" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <p className="app-Footer__cookies">
          <Icon name="security" size={16} />
          {FOOTER.cookies}
        </p>
        <div className="app-Footer__fine">
          {FOOTER.fineprint.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    </footer>
  );
}
