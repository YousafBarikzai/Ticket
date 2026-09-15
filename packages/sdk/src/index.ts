/** `@itsm/sdk` — the typed client every application talks to the API through. */
export { ApiError, createClient, type Client, type ClientOptions, type RequestOptions } from './client.js';
export { ticketQuery, workbench, type TicketFilter, type Workbench } from './resources/workbench.js';
export type {
  AiCapability,
  AiJob,
  ConfidenceBand,
  JobSuggestion,
  Me,
  Page,
  SlaTimer,
  SlaTimers,
  Suggestion,
  SuggestionEvidence,
  SuggestionOutcome,
  Ticket,
  Timeline,
  TimelineAttachment,
  TimelineCommentEntry,
  TimelineEntry,
  TimelineEventEntry,
  TimelineTaskEntry,
  TimeSummary,
} from './resources/types.js';
