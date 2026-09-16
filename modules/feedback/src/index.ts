/** MOD-18 Feedback and surveys — public interface. */
export { feedbackManifest } from './manifest.js';
export * as surveyService from './service/survey-service.js';
export * as invitationService from './service/invitation-service.js';
export * as responseService from './service/response-service.js';
export { createSurveySchema, triggerSchema, TRIGGER_KINDS, type CreateSurveyInput, type TriggerInput, type TriggerKind } from './service/survey-service.js';
export {
  surveyDocumentSchema,
  scoringSchema,
  assertDocumentIsCoherent,
  evaluateAnswers,
  normaliseScore,
  scaleLabel,
  questionsOf,
  type SurveyDocument,
  type Scoring,
  type AnswerOutcome,
} from './domain/survey-document.js';
export { withinThrottle, expiryFor } from './domain/throttle.js';
export { seedFeedbackDefaults, DEFAULT_SURVEY } from './seed/defaults.js';
export { renderSurveyPage, renderThanksPage } from './service/page.js';
import './handlers/index.js';
import './notifications.js';
import './chat.js';
import './jobs/index.js';
