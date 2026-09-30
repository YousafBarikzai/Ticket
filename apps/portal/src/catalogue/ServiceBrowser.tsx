'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CatalogueItem } from '@itsm/sdk';
import { announce, Card, EmptyState, SearchField, useUrlState, type UrlCodec } from '@itsm/ui';
import { useHelpFlow } from '../components/PortalShell.js';
import { serviceIcon } from './icons.js';
import { filterCatalogue, groupByService, type CatalogueGroup } from './group.js';

/**
 * The catalogue, browsed (SPEC §6.3 `/catalogue`): a search over what the
 * person may request, a row of service chips that jump to each section and
 * follow the one in view, and each service as a grid of cards — icon from
 * the service's words (the catalogue has no icons of its own, §7.5), name,
 * summary, and the whole card a way in.
 *
 * The search is a filter over the list already on the page, so it answers
 * on every pause without a round trip; the words live in `?q=` (replaced
 * without a server render, D12), so a link from Home's topic tiles or
 * `/search`'s "See all" arrives filtered, and a reload keeps it.
 *
 * Nothing on the page says which items need an approval or how long they
 * take: the catalogue carries no such data (§6.3), and a guess would be a
 * promise nobody made.
 */

export interface ServiceBrowserProps {
  /** What this person may request — already filtered by entitlement on the server. */
  readonly items: readonly CatalogueItem[];
}

const queryCodec: UrlCodec<{ q: string }> = {
  parse: (params) => ({ q: params.get('q')?.slice(0, 200) ?? '' }),
  serialise: (value) => ({ q: value.q.trim() || undefined }),
};

/** "3 services match", for the polite announcement after a search settles. */
export function matchSummary(count: number): string {
  if (count === 0) return 'Nothing matches';
  return count === 1 ? '1 service matches' : `${count} services match`;
}

/**
 * Which section is in view, for the chip that should read as current: the
 * first (in page order) whose top has crossed below the sticky chips and not
 * yet left the upper half of the screen. Without `IntersectionObserver` the
 * first section is current, which is where the page starts.
 */
function useSectionInView(anchors: readonly string[]): [string | null, (anchor: string) => void] {
  const [current, setCurrent] = useState<string | null>(anchors[0] ?? null);
  const joined = anchors.join('\n');

  useEffect(() => {
    const list = joined ? joined.split('\n') : [];
    setCurrent((was) => (was && list.includes(was) ? was : (list[0] ?? null)));
    if (typeof IntersectionObserver !== 'function' || list.length < 2) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = list.find((anchor) => visible.has(anchor));
        if (first) setCurrent(first);
      },
      { rootMargin: '-120px 0px -50% 0px' },
    );
    for (const anchor of list) {
      const section = document.getElementById(anchor);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [joined]);

  return [current, setCurrent];
}

export function ServiceBrowser({ items }: ServiceBrowserProps): ReactNode {
  const help = useHelpFlow();
  const [{ q: query }, setUrl] = useUrlState(queryCodec, { shallow: true });
  const words = query.trim();

  const groups = useMemo(() => groupByService(filterCatalogue(items, words)), [items, words]);
  const anchors = useMemo(() => groups.map((group) => group.anchor), [groups]);
  const [current, setCurrent] = useSectionInView(anchors);
  const count = groups.reduce((sum, group) => sum + group.items.length, 0);

  // A settled search is spoken once — the list changed away from the field the person is typing in.
  const spoken = useRef(words);
  useEffect(() => {
    if (spoken.current === words) return;
    spoken.current = words;
    announce(words ? matchSummary(count) : `${count} services`, { politeness: 'polite' });
  }, [words, count]);

  if (items.length === 0) {
    return (
      <EmptyState
        size="md"
        icon="catalogue"
        headingLevel={2}
        title="Nothing to request yet"
        description="Your IT team hasn’t published anything here. You can still tell us what you need."
        action={help.available ? { id: 'report', label: 'Report an issue', icon: 'compose', variant: 'tinted' } : undefined}
        onAction={() => help.open()}
      />
    );
  }

  return (
    <div className="app-Services">
      <SearchField
        className="app-Services__search"
        label="Search services"
        labelHidden
        size="lg"
        placeholder="Search for software, access, equipment…"
        value={query}
        onValueChange={(next) => setUrl({ q: next })}
      />

      {groups.length > 1 ? <ServiceChips groups={groups} current={current} onPick={setCurrent} /> : null}

      {groups.length === 0 ? (
        <EmptyState
          size="md"
          tone="search"
          icon="search"
          headingLevel={2}
          title={`Nothing matches ‘${words}’`}
          description="Try other words, or tell us what you need and we’ll sort it out."
          action={help.available ? { id: 'report', label: 'Report an issue instead', icon: 'compose', variant: 'tinted' } : undefined}
          secondaryAction={{ id: 'clear', label: 'Clear search' }}
          onAction={(id) => {
            if (id === 'report') help.open({ step: 'details', text: words });
            else setUrl({ q: '' });
          }}
        />
      ) : (
        groups.map((group) => <ServiceSection key={group.anchor} group={group} />)
      )}
    </div>
  );
}

function ServiceChips({ groups, current, onPick }: { readonly groups: readonly CatalogueGroup[]; readonly current: string | null; readonly onPick: (anchor: string) => void }): ReactNode {
  const listRef = useRef<HTMLUListElement | null>(null);

  // The current chip stays in view in the row, which scrolls sideways on a phone.
  useEffect(() => {
    const chip = current ? listRef.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(current)}"]`) : null;
    if (!chip || typeof chip.scrollIntoView !== 'function') return;
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  return (
    <nav className="app-Services__chips" aria-label="Jump to a service">
      <ul ref={listRef} className="app-Services__chipList">
        {groups.map((group) => (
          <li key={group.anchor}>
            <a
              className="app-Services__chip"
              href={`#${encodeURIComponent(group.anchor)}`}
              data-anchor={group.anchor}
              aria-current={current === group.anchor ? 'true' : undefined}
              onClick={() => onPick(group.anchor)}
            >
              {group.service}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ServiceSection({ group }: { readonly group: CatalogueGroup }): ReactNode {
  const headingId = `${group.anchor}-title`;
  return (
    <section id={group.anchor} className="app-Services__section" aria-labelledby={headingId}>
      <h2 id={headingId} className="app-Services__service">
        {group.service}
      </h2>
      <ul className="app-Services__grid">
        {group.items.map((item) => (
          <Card
            key={item.key}
            as="li"
            titleAs="h3"
            className="app-ServiceCard"
            padding="md"
            radius="xl"
            icon={serviceIcon(item.name, item.shortSummary, item.service)}
            title={item.name}
            {...(item.shortSummary ? { subtitle: item.shortSummary } : {})}
            href={`/catalogue/${encodeURIComponent(item.key)}`}
          />
        ))}
      </ul>
    </section>
  );
}
