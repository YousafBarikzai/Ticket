import type { ReactNode } from 'react';
import { Icon, channelInfo } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { answerFacts, type ComingUp, type PopularAnswer } from './model.js';

/**
 * Home's aside (v3 §7.2, A6 §6.1.2), replacing v2's "Good to know" card:
 *
 *   - **Popular answers** — the four most read articles, with their views and,
 *     from five votes, the share who found each helpful; shown only when at
 *     least three are published;
 *   - **Coming up** — planned maintenance in the next fourteen days, with
 *     when and what it affects; left out when there is none;
 *   - **Other ways to reach us** — the channels the deploy configured.
 *
 * Each part shows only when it has something true to say. With nothing at
 * all and permission to read help articles, one quiet link to Knowledge
 * stands in. Server-drawn: the links are the app's link leaf.
 */

export interface HomeAsideProps {
  readonly answers: readonly PopularAnswer[];
  readonly comingUp: readonly ComingUp[];
  readonly channels: readonly string[];
  readonly canBrowseKnowledge: boolean;
  readonly locale: string;
}

export function HomeAside({ answers, comingUp, channels, canBrowseKnowledge, locale }: HomeAsideProps): ReactNode {
  const nothing = answers.length === 0 && comingUp.length === 0 && channels.length === 0;
  if (nothing && !canBrowseKnowledge) return null;

  return (
    <aside className="app-HomeAside" aria-label="Help and news">
      {answers.length > 0 ? (
        <section className="app-HomeAside__part" aria-labelledby="home-popular">
          <h2 id="home-popular" className="app-HomeAside__title">
            Popular answers
          </h2>
          <ul className="app-HomeAside__list">
            {answers.map((answer) => (
              <li key={answer.key} className="app-HomeAside__answer">
                <Icon name="book-open" size="sm" className="app-HomeAside__icon" />
                <span className="app-HomeAside__text">
                  <AppLink className="app-HomeAside__link" href={`/knowledge/${encodeURIComponent(answer.key)}`}>
                    {answer.title}
                  </AppLink>
                  <span className="app-HomeAside__facts">{answerFacts(answer, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {comingUp.length > 0 ? (
        <section className="app-HomeAside__part" aria-labelledby="home-coming-up">
          <h2 id="home-coming-up" className="app-HomeAside__title">
            Coming up
          </h2>
          <ul className="app-HomeAside__list">
            {comingUp.map((window) => (
              <li key={window.id} className="app-HomeAside__window">
                <Icon name="wrench" size="sm" className="app-HomeAside__icon" />
                <span className="app-HomeAside__text">
                  <span className="app-HomeAside__when">
                    <time dateTime={window.startsAt}>{window.when}</time>
                    {window.inProgress ? <span className="app-HomeAside__now"> · Under way</span> : null}
                  </span>
                  <span className="app-HomeAside__what">{window.title}</span>
                  {window.affects.length > 0 ? <span className="app-HomeAside__facts">Affects {window.affects.join(', ')}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {channels.length > 0 ? (
        <section className="app-HomeAside__part" aria-labelledby="home-channels">
          <h2 id="home-channels" className="app-HomeAside__title">
            Other ways to reach us
          </h2>
          <ul className="app-HomeAside__channels">
            {channels.map((channel) => {
              const info = channelInfo(channel);
              return (
                <li key={channel} className="app-HomeAside__channel">
                  <Icon name={info.icon} size="sm" />
                  <span>{info.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {nothing ? (
        <p className="app-HomeAside__quiet">
          <AppLink className="app-HomeAside__link" href="/knowledge">
            <Icon name="knowledge" size="sm" className="app-HomeAside__icon" />
            <span>Browse help articles</span>
          </AppLink>
        </p>
      ) : null}
    </aside>
  );
}
