/** `@itsm/sdk` — the typed client every application talks to the API through. */
export { ApiError, createClient, type Client, type ClientOptions, type RequestOptions } from './client.js';
export { workbench, type TicketFilter, type Workbench } from './resources/workbench.js';
export type {
  AiJob,
  ConfidenceBand,
  Me,
  Page,
  SlaTimer,
  Suggestion,
  SuggestionEvidence,
  Ticket,
  Timeline,
  TimelineComment,
  TimelineEntry,
  TimeSummary,
} from './resources/types.js';
