'use client';

import type { ReactNode } from 'react';
import type { CatalogueItem, SearchHit, Ticket } from '@itsm/sdk';
import { Banner, Button, Icon, Spinner, StatusPill, cx } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { serviceIcon } from '../catalogue/icons.js';
import { requestHref } from '../client/palette.js';
import { highlight } from '../knowledge/highlight.js';
import { requesterState, typeLabel } from '../tickets/presentation.js';
import { isSevere, type KnownIssue } from './model.js';
import { hasSuggestions, type Suggestions } from './suggestions.js';

/**
 * Step 1's results, under the field (SPEC §6.3): "Is it this?" when an open
 * incident sounds like what they typed, then what might already answer
 * them — help articles (opened here, in the flow), services they could ask
 * for, and requests of their own that sound the same.
 *
 * Nothing here blocks the way on: the footer's "Continue — report this as an
 * issue" is always there. A search that found nothing says so in one quiet
 * line rather than an empty state, because the next step is obvious.
 */

type Heading = 'h2' | 'h3';

export function KnownIssueCallout({
  issues,
  followUrl,
  onDismiss,
}: {
  readonly issues: readonly KnownIssue[];
  readonly followUrl: string | null;
  readonly onDismiss: () => void;
}): ReactNode {
  const [first] = issues;
  if (!first) return null;
  const more = issues.length - 1;
  return (
    <Banner
      tone={issues.some(isSevere) ? 'danger' : 'warning'}
      title="Is it this?"
      className="app-HelpFlow__issue"
      action={
        <>
          {followUrl ? (
            <Button size="sm" variant="secondary" href={followUrl} external>
              Follow updates
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            It’s something else
          </Button>
        </>
      }
    >
      <p className="app-HelpFlow__issueText">
        <strong>{first.title.replace(/[\s.!?]+$/, '')}.</strong> We know about it and we’re on it{first.components.length > 0 ? ` · ${first.components.join(', ')}` : ''}
        {more > 0 ? ` · and ${more} more open ${more === 1 ? 'issue' : 'issues'}` : ''}.
      </p>
    </Banner>
  );
}

export interface SuggestedProps {
  readonly found: Suggestions;
  /** Unique per flow on the page: the group headings' ids start with it. */
  readonly idPrefix: string;
  readonly headingAs: Heading;
  readonly onOpenAnswer: (hit: SearchHit) => void;
}

function AnswerItem({ hit, onOpen }: { readonly hit: SearchHit; readonly onOpen: (hit: SearchHit) => void }): ReactNode {
  return (
    <li>
      <button type="button" className="app-HelpFlow__option" data-answer={hit.entityId} onClick={() => onOpen(hit)}>
        <Icon name="knowledge" size="sm" className="app-HelpFlow__optionIcon" />
        <span className="app-HelpFlow__optionText">
          <span className="app-HelpFlow__optionTitle">{hit.title}</span>
          {hit.snippet ? <span className="app-HelpFlow__optionDetail">{highlight(hit.snippet)}</span> : null}
        </span>
        <Icon name="chevron-right" size="sm" directional className="app-HelpFlow__optionEnd" />
      </button>
    </li>
  );
}

function ServiceItem({ item }: { readonly item: CatalogueItem }): ReactNode {
  return (
    <li>
      <AppLink className="app-HelpFlow__option" href={`/catalogue/${encodeURIComponent(item.key)}`}>
        <Icon name={serviceIcon(item.service, item.name, item.shortSummary)} size="sm" className="app-HelpFlow__optionIcon" />
        <span className="app-HelpFlow__optionText">
          <span className="app-HelpFlow__optionTitle">{item.name}</span>
          {item.shortSummary || item.service ? <span className="app-HelpFlow__optionDetail">{item.shortSummary ?? item.service}</span> : null}
        </span>
        <Icon name="chevron-right" size="sm" directional className="app-HelpFlow__optionEnd" />
      </AppLink>
    </li>
  );
}

function RequestItem({ ticket }: { readonly ticket: Ticket }): ReactNode {
  const state = requesterState(ticket.status);
  return (
    <li>
      <AppLink className="app-HelpFlow__option" href={requestHref(ticket.number)}>
        <Icon name="ticket" size="sm" className="app-HelpFlow__optionIcon" />
        <span className="app-HelpFlow__optionText">
          <span className="app-HelpFlow__optionTitle">{ticket.title}</span>
          <span className="app-HelpFlow__optionDetail app-HelpFlow__optionMeta">
            <span className="app-HelpFlow__number">{ticket.number}</span> · {typeLabel(ticket.type)}
            <StatusPill size="sm" srPrefix="Status" label={state.label} tone={state.tone} icon={state.icon} />
          </span>
        </span>
        <Icon name="chevron-right" size="sm" directional className="app-HelpFlow__optionEnd" />
      </AppLink>
    </li>
  );
}

function Group({ id, title, headingAs: H, children }: { readonly id: string; readonly title: string; readonly headingAs: Heading; readonly children: ReactNode }): ReactNode {
  return (
    <section className="app-HelpFlow__group" aria-labelledby={id}>
      <H id={id} className="app-HelpFlow__groupTitle">
        {title}
      </H>
      <ul className="app-HelpFlow__options">{children}</ul>
    </section>
  );
}

/** What might already help, grouped; one quiet line while asking and when nothing matched. */
export function Suggested({ found, idPrefix, headingAs, onOpenAnswer }: SuggestedProps): ReactNode {
  const any = hasSuggestions(found);
  // Nothing typed yet: no empty box holding a gap open under the field.
  if (!any && !found.loading && !found.query) return null;
  return (
    <div className={cx('app-HelpFlow__suggested', found.loading && 'app-HelpFlow__suggested--busy')} aria-busy={found.loading || undefined}>
      {any ? (
        <>
          <p className="app-HelpFlow__lead">Might these help?</p>
          {found.answers.length > 0 ? (
            <Group id={`${idPrefix}-answers`} title="Answers" headingAs={headingAs}>
              {found.answers.map((hit) => (
                <AnswerItem key={hit.entityId} hit={hit} onOpen={onOpenAnswer} />
              ))}
            </Group>
          ) : null}
          {found.services.length > 0 ? (
            <Group id={`${idPrefix}-services`} title="Services" headingAs={headingAs}>
              {found.services.map((item) => (
                <ServiceItem key={item.key} item={item} />
              ))}
            </Group>
          ) : null}
          {found.requests.length > 0 ? (
            <Group id={`${idPrefix}-requests`} title="Your requests" headingAs={headingAs}>
              {found.requests.map((ticket) => (
                <RequestItem key={ticket.id} ticket={ticket} />
              ))}
            </Group>
          ) : null}
        </>
      ) : found.loading ? (
        <p className="app-HelpFlow__quiet">
          <Spinner size="sm" /> Looking for answers…
        </p>
      ) : found.query ? (
        <p className="app-HelpFlow__quiet">
          {found.incomplete ? 'We couldn’t look for answers just now.' : `Nothing we know of matches “${found.query}”.`} Continue and we’ll pick it up.
        </p>
      ) : null}
    </div>
  );
}
