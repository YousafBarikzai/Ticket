'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, FormField, Icon, Textarea } from '@itsm/ui';
import { api } from '../client/api.js';
import { useHelpFlow } from '../components/PortalShell.js';

/**
 * The one card at the end of an article (SPEC §6.3, X-14): "Did this solve
 * it?"
 *
 * - **Yes** records it, and says "Glad that helped." — the thanks takes
 *   focus, so a screen reader hears that the answer landed — with a quiet
 *   way to report an issue anyway.
 * - **No, report an issue** asks, optionally, what they were looking for
 *   (the one detail an author can act on), records the answer with it, and
 *   opens "How can we help?" at its details step: "I read 'Set up the VPN'
 *   and it didn't help:" and their words, so nobody types the story twice.
 *   Without `ticket.create` the same question ends in a plain Send.
 *
 * The rating is fire-and-forget: nobody came to this page to leave
 * feedback, and an error about it would be the loudest thing on an article
 * somebody is trying to read.
 */

export interface ArticleEndProps {
  readonly articleKey: string;
  readonly title: string;
}

type Stage = 'ask' | 'helped' | 'explain' | 'thanked';

/** What the report flow starts with, after an article did not help. */
export function reportDetails(title: string, note: string): string {
  const lead = `I read ‘${title}’ and it didn’t help:`;
  const words = note.trim();
  return words ? `${lead} ${words}` : lead;
}

export function ArticleEnd({ articleKey, title }: ArticleEndProps): ReactNode {
  const help = useHelpFlow();
  const [stage, setStage] = useState<Stage>('ask');
  const [note, setNote] = useState('');
  const thanks = useRef<HTMLParagraphElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const no = useRef<HTMLButtonElement | null>(null);
  const shown = useRef<Stage>(stage);

  // Focus follows the card when it changes (never on first render): onto the
  // thanks, into the question, or back to "No" after Cancel.
  useEffect(() => {
    if (shown.current === stage) return;
    shown.current = stage;
    if (stage === 'helped' || stage === 'thanked') thanks.current?.focus();
    else if (stage === 'explain') field.current?.focus();
    else no.current?.focus();
  }, [stage]);

  const record = (helpful: boolean, comment?: string): void => {
    void api.rateArticle(articleKey, helpful, comment).catch(() => undefined);
  };

  const finish = (): void => {
    const words = note.trim().slice(0, 1000);
    record(false, words || undefined);
    setStage('thanked');
    if (help.available) help.open({ step: 'details', details: reportDetails(title, words) });
  };

  return (
    <section className="app-ArticleEnd" aria-labelledby="article-end-title">
      <h2 id="article-end-title" className="app-ArticleEnd__title">
        Did this solve it?
      </h2>

      {stage === 'ask' ? (
        <>
          <p className="app-ArticleEnd__quiet">Your answer helps whoever looks after this article.</p>
          <div className="app-ArticleEnd__actions">
            <Button
              variant="secondary"
              iconStart="check"
              onClick={() => {
                record(true);
                setStage('helped');
              }}
            >
              Yes
            </Button>
            <Button ref={no} variant="secondary" onClick={() => setStage('explain')}>
              {help.available ? 'No, report an issue' : 'No'}
            </Button>
          </div>
        </>
      ) : null}

      {stage === 'explain' ? (
        <div className="app-ArticleEnd__explain">
          <FormField label="What were you looking for?" optional hint={help.available ? 'We’ll pass this on, and start your report with it.' : 'We’ll pass this on to whoever looks after this article.'}>
            <Textarea ref={field} rows={3} autoGrow maxRows={8} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
          <div className="app-ArticleEnd__actions">
            <Button variant="tinted" iconStart={help.available ? 'compose' : 'send'} {...(help.available ? { 'aria-haspopup': 'dialog' as const } : {})} onClick={finish}>
              {help.available ? 'Report an issue' : 'Send'}
            </Button>
            <Button variant="ghost" onClick={() => setStage('ask')}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 'helped' || stage === 'thanked' ? (
        <>
          <p ref={thanks} tabIndex={-1} className="app-ArticleEnd__thanks">
            <Icon name={stage === 'helped' ? 'circle-check' : 'check'} size="md" className="app-ArticleEnd__thanksIcon" />
            {stage === 'helped' ? 'Glad that helped.' : 'Thanks. That goes to whoever looks after this article.'}
          </p>
          {help.available ? (
            <p className="app-ArticleEnd__quiet app-ArticleEnd__still">
              Still need help?
              <Button variant="ghost" size="sm" iconStart="compose" aria-haspopup="dialog" onClick={() => help.open({ step: 'details', details: reportDetails(title, note) })}>
                Report an issue
              </Button>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
