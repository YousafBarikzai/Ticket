import type { ReactNode } from 'react';
import { isServiceDeskRoutePending } from '@itsm/contracts/areas';
import { Avatar, Icon } from '@itsm/ui';
import { DemoBar } from '@itsm/ui/shell';
import { CtaLink } from '../components/CtaLink.js';
import { DeviceFrame } from '../components/DeviceFrame.js';
import { FeatureCard } from '../components/FeatureCard.js';
import { HowSteps } from '../components/HowSteps.js';
import { RoleButton } from '../components/RoleButton.js';
import { SiteFooter } from '../components/SiteFooter.js';
import { SiteHeader } from '../components/SiteHeader.js';
import { Spotlight } from '../components/Spotlight.js';
import { CARDS, EXPLORE, FINAL, HERO, HOW, PREVIEW, SPOTLIGHTS, UNAVAILABLE, persona, type TryIt } from '../landing/content.js';
import { HeroPreview } from '../landing/HeroPreview.js';
import { siteConfig } from '../server/config.js';
import { demoStatusNote, getDemoStatus } from '../server/demo-status.js';
import { demoHref } from '../server/links.js';

/**
 * The landing page (SPEC v3 §6.2; A5 §4 as amended by X-M1, X-M2, X-B2,
 * X-m3, X-m7, X-m24, V-m3; PMO benchmark `scratchpad/pmo/shots2/landing-*`).
 *
 * One click from the hero into the product: "Explore as an agent →" is a
 * plain link to the Service Desk's `/demo` page as Alex Morgan, which signs
 * the visitor in to the shared demo and lands on the Overview — the same
 * Overview the device frame below it previews. The other two personas are a
 * line under it, each with their name and job title, and the final band
 * repeats all three. Every role link is `rel="nofollow"` and never
 * `noreferrer`: the app opens the demo in one click only when the Referer
 * names this site (D22), which is also why the site sends
 * `strict-origin-when-cross-origin`.
 *
 * Rendered per request: the links are runtime configuration (the image is
 * built before the hosts exist), and the demo's state changes what the strip,
 * the hero pill and a note under the buttons say. With `DEMO_MODE` off the
 * page is a product page with "Sign in" in place of every role link and no
 * "How the demo works". The browser never calls the API; the status is read
 * by this server, memoised for ten seconds.
 *
 * The page draws the demo strip itself, above its header, in the state the
 * status read found; the chooser draws its own in `SignInLayout`.
 *
 * Server components only. The page's own JavaScript is none: the strip's two
 * islands are the design system's, and the continue hint is an inline script
 * in the layout.
 */
export const dynamic = 'force-dynamic';

export default async function LandingPage(): Promise<ReactNode> {
  const config = siteConfig();
  const status = await getDemoStatus(config);
  const demo = status.mode === 'on';
  const now = status.mode === 'on' ? status.clock.serverNow : Date.now();
  const pill = status.mode === 'on' ? (status.state === 'preparing' || status.state === 'paused' ? status.state : 'ready') : null;
  const note = demoStatusNote(status);

  const agent = persona('agent');
  const others = [persona('employee'), persona('admin')];
  const agentHref = demo ? demoHref(config, 'agent') : null;
  /** A "Try it" is shown only in the demo, and only once the route it needs is in this build (H4, RV6). */
  const showTryIt = (tryIt: TryIt): boolean => demo && !(tryIt.needs && isServiceDeskRoutePending(tryIt.needs));

  // Said under each set of role links; a status region only in the hero, so it is not announced twice.
  const statusNote = (live: boolean): ReactNode =>
    note ? (
      <p className="app-StatusNote" {...(live ? { role: 'status' } : {})}>
        <Icon name="circle-alert" size={16} />
        {note}
      </p>
    ) : null;

  return (
    <div className="app-Landing">
      {status.mode === 'on' ? (
        // The public strip (X9): an unanswered status read is drawn as ready — the role links still work, and the app's own `/demo` page decides.
        <DemoBar variant="public" clock={status.clock} state={status.state === 'unknown' ? 'ready' : status.state} links={{ home: '/', howItWorks: '#how-it-works' }} />
      ) : null}
      <SiteHeader ctaHref={agentHref} demo={demo} />
      <main id="main" tabIndex={-1} className="app-Main">
        <section id="top" className="app-Hero" data-surface="hero" aria-labelledby="hero-title">
          <div className="app-Wrap app-Hero__inner">
            {pill ? (
              <p className="app-Pill" data-state={pill}>
                <span className="app-Pill__dot" aria-hidden="true" />
                {HERO.pill(pill, status.mode === 'on' ? status.etaSec : null)}
              </p>
            ) : null}
            <h1 id="hero-title" className="app-Hero__title">
              <span className="app-Hero__titleA">{HERO.titleA}</span> <span className="app-Hero__titleB">{HERO.titleB}</span>
            </h1>
            <p className="app-Hero__lead">{HERO.lead}</p>
            {demo ? (
              <div className="app-Hero__ctas">
                <div className="app-Hero__primary">
                  {agentHref ? (
                    <CtaLink href={agentHref} persona={agent.key}>
                      {HERO.primary}
                    </CtaLink>
                  ) : (
                    <p className="app-Unavailable">{UNAVAILABLE}</p>
                  )}
                  <p className="app-Hero__persona">{HERO.personaLine}</p>
                </div>
                <div className="app-Hero__secondary">
                  <span className="app-Hero__or">{HERO.or}</span>
                  <ul className="app-Hero__people">
                    {others.map((entry) => {
                      const href = demoHref(config, entry.key);
                      return (
                        <li key={entry.key}>
                          {href ? (
                            <a className="app-PersonLink" href={href} rel="nofollow" data-persona={entry.key} aria-label={HERO.secondaryLabel(entry)}>
                              <Avatar name={entry.name} initials={entry.initials} size="xs" decorative />
                              <span className="app-PersonLink__text">
                                <span className="app-PersonLink__role">{entry.button}</span>
                                <span className="app-PersonLink__who">
                                  {entry.name}, {entry.title}
                                </span>
                              </span>
                            </a>
                          ) : (
                            <span className="app-PersonLink" data-persona-unavailable={entry.key}>
                              <span className="app-PersonLink__text">
                                <span className="app-PersonLink__role">{entry.button}</span>
                                <span className="app-PersonLink__who">{UNAVAILABLE}</span>
                              </span>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <CtaLink href="/sign-in" variant="ghost" icon="log-in" className="app-Hero__signIn">
                    {HERO.signIn}
                  </CtaLink>
                </div>
                {statusNote(true)}
              </div>
            ) : (
              <div className="app-Hero__ctas">
                <div className="app-Hero__offRow">
                  <CtaLink href="/sign-in" icon="log-in">
                    {HERO.offPrimary}
                  </CtaLink>
                  <CtaLink href="#explore" variant="ghost">
                    {HERO.offSecondary}
                  </CtaLink>
                </div>
              </div>
            )}
            <ul className="app-Hero__meta">
              {(demo ? HERO.meta : HERO.metaOff).map((line) => (
                <li key={line.text}>
                  <Icon name={line.icon} size={16} />
                  {line.text}
                </li>
              ))}
            </ul>
            <div className="app-Hero__frame">
              <DeviceFrame label={PREVIEW.label} caption={PREVIEW.caption}>
                <HeroPreview now={now} />
              </DeviceFrame>
            </div>
          </div>
        </section>

        <section id="explore" className="app-Explore" aria-labelledby="explore-title">
          <div className="app-Wrap">
            <header className="app-SectionHead">
              <p className="app-SectionHead__eyebrow itsm-text-eyebrow">{EXPLORE.eyebrow}</p>
              <h2 id="explore-title" className="app-SectionHead__title">
                {EXPLORE.title}
              </h2>
              <p className="app-SectionHead__sub">{demo ? EXPLORE.sub : EXPLORE.subOff}</p>
            </header>
            <div className="app-Spots">
              {SPOTLIGHTS.map((spotlight, index) => (
                <Spotlight key={spotlight.id} spotlight={spotlight} flipped={index % 2 === 1} showTryIt={showTryIt(spotlight.tryIt)} />
              ))}
            </div>
            <div className="app-Cards">
              {CARDS.map((card) => (
                <FeatureCard key={card.id} card={card} showTryIt={showTryIt(card.tryIt)} />
              ))}
            </div>
          </div>
        </section>

        {demo ? (
          <section id="how-it-works" className="app-How" aria-labelledby="how-title">
            <div className="app-Wrap">
              <header className="app-SectionHead">
                <p className="app-SectionHead__eyebrow itsm-text-eyebrow">{HOW.eyebrow}</p>
                <h2 id="how-title" className="app-SectionHead__title">
                  {HOW.title}
                </h2>
                <p className="app-SectionHead__sub">{HOW.sub}</p>
              </header>
              <HowSteps steps={HOW.steps} />
              <p className="app-How__note">
                <Icon name="info" size={16} />
                {HOW.note}
              </p>
            </div>
          </section>
        ) : null}

        <section className="app-Final" data-surface="hero" aria-labelledby="final-title">
          <div className="app-Wrap app-Final__inner">
            <h2 id="final-title" className="app-Final__title">
              {demo ? FINAL.title : FINAL.titleOff}
            </h2>
            <p className="app-Final__sub">{demo ? FINAL.sub : FINAL.subOff}</p>
            {demo ? (
              <>
                <ul className="app-Roles">
                  {(['employee', 'agent', 'admin'] as const).map((key) => (
                    <li key={key}>
                      <RoleButton persona={persona(key)} href={demoHref(config, key)} />
                    </li>
                  ))}
                </ul>
                {statusNote(false)}
                <p className="app-Final__already">
                  {FINAL.already}{' '}
                  <a className="app-Final__link" href="/sign-in">
                    {FINAL.signIn}
                  </a>
                </p>
              </>
            ) : (
              <CtaLink href="/sign-in" icon="log-in">
                {FINAL.ctaOff}
              </CtaLink>
            )}
          </div>
        </section>
      </main>
      <SiteFooter year={new Date(now).getUTCFullYear()} demo={demo} />
    </div>
  );
}
