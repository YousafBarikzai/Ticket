import type { ReactNode } from 'react';
import { Banner } from '@itsm/ui';

/** The banner's words for `subject` ("decisions"): what the figures are made from, and that no model is called (D13). */
export function sampleNoteText(subject: string): string {
  return `These figures come from sample ${subject.trim() || 'data'} in this demo. No AI model is called.`;
}

/**
 * "SAMPLE DATA" over the AI triage pages of the shared demo (D13, A7 §2.8):
 * the decisions there were written by the demo build, not by a model, and a
 * prospect must not read them as a measured accuracy.
 *
 * Shown by the page when the API says the figures include samples
 * (`score.samples > 0`), so a real tenant never sees it. The kicker is one of
 * the two places Administration has one (D6). A server component.
 */
export function SampleNote({ subject }: { readonly subject: string }): ReactNode {
  return (
    <Banner tone="info" kicker="Sample data" icon="sparkles" className="app-SampleNote">
      {sampleNoteText(subject)}
    </Banner>
  );
}
