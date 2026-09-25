/** MOD-09 AI capability service — public interface. */
export { aiManifest } from './manifest.js';
export * as suggestionService from './service/suggestion-service.js';
export * as aiBudgetService from './service/budget-service.js';
export * as promptService from './service/prompt-service.js';
export * as evalService from './service/eval-service.js';
export {
  getJob,
  listSuggestions,
  outcomeSchema,
  recordOutcome,
  requestSchema,
  requestSuggestion,
  runSuggestionJob,
  sweepPrompts,
  type RequestResult,
  type SuggestionRequest,
} from './service/suggestion-service.js';
export {
  assertWithinBudget,
  budgetForPeriod,
  budgetSchema,
  readBudget,
  recordSpend,
  setBudget,
  type BudgetInput,
} from './service/budget-service.js';
export {
  currentVersionOf,
  getPrompt,
  listPrompts,
  promotePrompt,
  promptVersionSchema,
  savePromptVersion,
  seedAiPrompts,
  unknownPaths,
  PROMPT_PATHS,
} from './service/prompt-service.js';
export { listDatasets, listRuns, runEvaluation, scoreCase, seedAiDatasets, type CaseExpectation, type CaseScore } from './service/eval-service.js';
export { ModelNotPriced, NoProviderConfigured, callModel, type GatewayCall, type GatewayResult } from './service/gateway.js';
export { assemble, gatherEvidence, renderable, type Assembled } from './service/context-service.js';
export {
  CAPABILITIES,
  CAPABILITY_CATALOGUE,
  callsAModel,
  definitionFor,
  isCapability,
  type AssembledContext,
  type Capability,
  type CapabilityDefinition,
  type Evidence,
  type EvidenceKind,
} from './domain/capabilities.js';
export {
  MICROS_PER_PENNY,
  clearModelPrices,
  isPriced,
  parseModelPrices,
  priceFor,
  pricedModels,
  registerModelPrices,
  costOf,
  crossings,
  formatMicros,
  formatPence,
  penceToMicros,
  periodFor,
  problemWithLines,
  refusalMessage,
  stateFor,
  type BudgetLines,
  type BudgetState,
} from './domain/budget.js';
export {
  UnparseableCompletion,
  approximateTokens,
  bandOf,
  parseCompletion,
  type ConfidenceBand,
  type ParsedCompletion,
} from './domain/output.js';
export {
  activeDefaultModel,
  activeProvider,
  chooseDefaultModel,
  addAiProvider,
  clearAiProvider,
  providerNamed,
  registerAiProvider,
  registeredProviderNames,
  type ProviderRegistration,
} from './providers/registry.js';
export { stubProvider } from './providers/stub.js';
export {
  anthropicProvider,
  finishReasonOf,
  isRetryable,
  textOf,
  ANTHROPIC_MODELS,
  ProviderRefused,
  ProviderUnavailable,
  type AnthropicOptions,
} from './providers/anthropic.js';
export type {
  AiProvider,
  Completion,
  CompletionRequest,
  Decision,
  DecisionAnswer,
  DecisionQuestion,
  DecisionRequest,
  DecisionValue,
} from './providers/types.js';
export {
  AUTO_APPLY_FIELDS,
  AUTO_GATE,
  DECISION_CATALOGUE,
  DECISION_MODES,
  DECISION_PURPOSES,
  DEFAULT_THRESHOLDS,
  SELECTABLE_MODES,
  STEP_DOWN,
  TRIAGE_CHANNELS,
  autoGate,
  checkDecision,
  decisionDefinitionFor,
  decisionModelFor,
  isDecisionPurpose,
  planDecision,
  problemWithThresholds,
  scoreAnswers,
  shouldStepDown,
  triageQuestions,
  triagesChannel,
  type DecisionMode,
  type DecisionPurpose,
  type Thresholds,
} from './domain/decisions.js';
export {
  decide,
  resetDecisionBreakers,
  skipReasonFor,
  type ChainAttempt,
  type DecideCall,
  type DecideResult,
} from './service/gateway.js';
export {
  listDecisions,
  modeFor,
  runTriage,
  scoreDecisions,
  settleDecisions,
  thresholdsFor,
  type DecisionListQuery,
  type DecisionScore,
  type DecisionSummary,
  type QuestionScore,
  type ScoreQuery,
  type TriageRun,
} from './service/decision-service.js';
export { tenantAiRegions } from './service/residency-service.js';
export { SHIPPED_DATASETS, SHIPPED_PROMPTS, type ShippedDataset, type ShippedPrompt } from './seed/prompts.js';
import './jobs/index.js';
import './handlers/index.js';
