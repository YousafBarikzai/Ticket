import type { ReactNode } from 'react';
import { PRODUCT_NAME, SITE } from '@itsm/contracts/areas';
import { VENDOR } from '@itsm/contracts/marketing';
import { BrandMark } from '@itsm/ui';
import { LEGAL_LINKS } from '../landing/roles-content.js';
import { LEGAL_EYEBROW, LEGAL_SCOPE, MISSING_FACTS_NOTE, ON_THIS_PAGE, formatLegalDate, type LegalBlock, type LegalDocument } from '../legal/types.js';
import '../legal/legal.css';

/** "Privacy · Cookies · Terms": under the chooser, the role pages and every legal page. */
export function LegalLinks(): ReactNode {
  return (
    <nav aria-label="Legal" className="app-LegalLinks">
      {LEGAL_LINKS.map((link, index) => (
        <span key={link.href}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          <a href={link.href}>{link.label}</a>
        </span>
      ))}
    </nav>
  );
}

function Block({ block }: { block: LegalBlock }): ReactNode {
  switch (block.kind) {
    case 'p':
      return <p>{block.text}</p>;
    case 'list':
      return (
        <ul>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="app-Legal__tableWrap">
          <table className="app-Legal__table">
            <caption>{block.caption}</caption>
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th key={cell} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={index} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={index}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * A legal page (A5 §11.1): a reduced header, the document as an article with
 * an "On this page" contents column on wide screens, and the legal links.
 *
 * Static and script-free. The content is data (`src/legal/*.ts`), so the
 * honesty and cookie tests read the same sentences this renders; a fact that
 * is still unconfirmed shows its written fallback and one quiet note under
 * the meta line, never a placeholder.
 */
export function LegalPage({ document: doc }: { document: LegalDocument }): ReactNode {
  return (
    <div className="app-Legal">
      <header className="app-Legal__header">
        <a className="app-Legal__lockup" href="/" aria-label={SITE.homeLabel}>
          <BrandMark size={32} />
          <span aria-hidden="true">{PRODUCT_NAME}</span>
        </a>
        <a className="app-Legal__signIn" href="/sign-in">
          Sign in
        </a>
      </header>
      <main id="main" tabIndex={-1} className="app-Legal__main">
        <article className="app-Legal__article" aria-labelledby="legal-title">
          <p className="app-Legal__eyebrow">{LEGAL_EYEBROW}</p>
          <h1 id="legal-title" className="app-Legal__title">
            {doc.title}
          </h1>
          <p className="app-Legal__lede">{doc.lede}</p>
          <p className="app-Legal__meta">{`Last updated ${formatLegalDate(doc.updated)} · ${LEGAL_SCOPE}`}</p>
          {doc.missingFacts ? <p className="app-Legal__note">{MISSING_FACTS_NOTE}</p> : null}
          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="app-Legal__section">
              <h2 id={`${section.id}-title`}>{section.heading}</h2>
              {section.blocks.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </section>
          ))}
        </article>
        <nav className="app-Legal__toc" aria-label={ON_THIS_PAGE}>
          <p className="app-Legal__tocTitle" aria-hidden="true">
            {ON_THIS_PAGE}
          </p>
          <ul>
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.heading}</a>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <footer className="app-Legal__footer">
        <LegalLinks />
        <p>{VENDOR.line}</p>
      </footer>
    </div>
  );
}
