/** MOD-09 Knowledge base (PH-3) — public interface. */
export { knowledgeManifest } from './manifest.js';
export * as articleService from './service/article-service.js';
export {
  createArticle,
  saveDraft,
  submitForReview,
  publishArticle,
  rollbackArticle,
  retireArticle,
  readArticle,
  listArticles,
  articleHistory,
  recordFeedback,
  linkToTicket,
  plainTextOf,
  articleSchema,
  draftSchema,
} from './service/article-service.js';
export { seedKnowledgeDefaults } from './seed/defaults.js';
export { AUDIENCES, aclForArticle, canRead, isAudience, type Audience } from './domain/audience.js';
export { ARTICLE_STATUSES, canTransition, transitionsFrom, refusalReason } from './domain/lifecycle.js';
import './handlers/index.js';
import './jobs/review-sweep.js';
