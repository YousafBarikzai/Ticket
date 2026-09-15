/**
 * MOD-16 workbench components.
 *
 * Kept apart from `web/` because these know what a ticket, an SLA target and a
 * suggestion *are*, where everything in `web/` knows only about buttons and
 * focus. An application may use `web/` without them; nothing in `web/` may
 * reach the other way.
 */
export {
  AiSuggestionCard,
  type AiSuggestionCardProps,
  type ConfidenceBand,
  type SuggestionEvidence,
  type SuggestionOutcome,
} from './AiSuggestionCard.js';
export { SlaClock, describeRemaining, type SlaClockProps, type SlaState } from './SlaClock.js';
