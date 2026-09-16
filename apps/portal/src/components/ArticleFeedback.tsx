'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@itsm/ui';
import { api } from '../client/api.js';

/**
 * "Did this help?"
 *
 * Two buttons and nothing else. The value of this question comes entirely from
 * how many people answer it, and every field added between the question and
 * the answer costs more responses than it gains detail — so the comment box
 * appears *after* "No", where there is something specific to say.
 *
 * A failure is swallowed rather than shown. Nobody came to this page to leave
 * feedback, and an error message about it would be the most prominent thing on
 * an article somebody is trying to read.
 */
export function ArticleFeedback({ articleKey }: { readonly articleKey: string }): ReactNode {
  const [answered, setAnswered] = useState<null | 'yes' | 'no'>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);

  async function record(helpful: boolean, note?: string): Promise<void> {
    try {
      await api.rateArticle(articleKey, helpful, note);
    } catch {
      // Not worth telling anybody about.
    }
  }

  if (sent) {
    return (
      <p className="itsm-Feedback" role="status">
        Thank you — that goes to whoever looks after this article.
      </p>
    );
  }

  if (answered === 'no') {
    return (
      <div className="itsm-Feedback">
        <label htmlFor="article-feedback">What were you looking for?</label>
        <textarea
          id="article-feedback"
          className="itsm-Textarea"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <Button
          variant="secondary"
          onClick={() => {
            void record(false, comment.trim() || undefined);
            setSent(true);
          }}
        >
          Send
        </Button>
      </div>
    );
  }

  return (
    <div className="itsm-Feedback">
      <p>Did this help?</p>
      <Button
        variant="secondary"
        onClick={() => {
          void record(true);
          setAnswered('yes');
          setSent(true);
        }}
      >
        Yes
      </Button>
      <Button variant="secondary" onClick={() => setAnswered('no')}>
        No
      </Button>
    </div>
  );
}
