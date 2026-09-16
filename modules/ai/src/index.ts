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
  DEFAULT_MODEL,
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
export { activeProvider, clearAiProvider, registerAiProvider } from './providers/registry.js';
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
export type { AiProvider, Completion, CompletionRequest } from './providers/types.js';
export { SHIPPED_DATASETS, SHIPPED_PROMPTS, type ShippedDataset, type ShippedPrompt } from './seed/prompts.js';
import './jobs/index.js';
