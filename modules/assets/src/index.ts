/** MOD-10-E1 Assets and the CMDB (PH-4) — public interface. */
export { assetsManifest } from './manifest.js';
export * as ciService from './service/ci-service.js';
export * as assetService from './service/asset-service.js';
export * as impactService from './service/impact-service.js';
export * as linkService from './service/link-service.js';
export {
  classAttributes,
  classSchema,
  createCi,
  createCiSchema,
  createClass,
  getCi,
  listCiSchema,
  listCis,
  listClasses,
  relate,
  relationshipSchema,
  relationshipsOf,
  retireCi,
  setStatus,
  statusSchema,
  unrelate,
  updateCi,
  updateCiSchema,
  updateClass,
  updateClassSchema,
} from './service/ci-service.js';
export {
  ASSET_STATUSES,
  assignAsset,
  assignSchema,
  createAsset,
  createAssetSchema,
  createModel,
  getAsset,
  listAssetSchema,
  listAssets,
  listModels,
  modelSchema,
  retireAsset,
  returnAsset,
  updateAssetSchema,
  updateAsset,
  warrantiesExpiring,
} from './service/asset-service.js';
export {
  DEFAULT_DEPTH,
  IMPACT_CACHE_SECONDS,
  MAX_DEPTH,
  dependencies,
  impact,
  impactQuerySchema,
  invalidateTraversals,
  type ImpactResult,
} from './service/impact-service.js';
export {
  ENTITY_TYPES,
  LINK_ROLES,
  cisFor,
  historyFor,
  linkCi,
  linkCiIn,
  linkSchema,
  unlinkCi,
  type EntityType,
  type LinkRole,
} from './service/link-service.js';
export {
  ATTRIBUTE_TYPES,
  assertAttributes,
  attributeListSchema,
  attributeSchema,
  checkAttributes,
  inheritedAttributes,
  type AttributeDefinition,
  type AttributeProblem,
} from './domain/attributes.js';
export {
  CI_STATUSES,
  CRITICALITIES,
  RELATIONSHIP_TYPES,
  SYMMETRIC_TYPES,
  assertRelationship,
  carriesImpact,
  describe,
  isRelationshipType,
  summarise,
  type Criticality,
  type ImpactSummary,
  type RelationshipType,
} from './domain/relationships.js';
export { type GraphNode } from './repo/graph-repo.js';
export { warrantyReport } from './jobs/warranty-sweep.js';
import './jobs/warranty-sweep.js';

// ---- MOD-10-E2 Discovery, reconciliation and contracts ----------------------
export * as discoveryService from './service/discovery-service.js';
export * as proposalService from './service/proposal-service.js';
export * as contractService from './service/contract-service.js';
export {
  createSource,
  describeKind,
  listKinds,
  listRules,
  listSources,
  ruleSchema,
  runSource,
  setRule,
  sourceSchema,
  updateSource,
  updateSourceSchema,
  type RunResult,
} from './service/discovery-service.js';
export {
  acceptAll,
  acceptProposal,
  listProposalSchema,
  listProposals,
  rejectProposal,
} from './service/proposal-service.js';
export {
  addCoverage,
  contractSchema,
  contractsCovering,
  coverageFor,
  coverageSchema,
  createContract,
  createSupplier,
  listContractSchema,
  listContracts,
  listSuppliers,
  needingAttention,
  supplierSchema,
  type ContractAttention,
} from './service/contract-service.js';
export { CONTRACT_KINDS, COST_PERIODS, assess, daysBetween, needsAttention, noticeDate, type Assessment } from './domain/contracts.js';
export { parseCsv, parseCsvRecords, type CsvOptions } from './domain/csv.js';
export {
  MAPPABLE_FIELDS,
  isMapped,
  mapRecord,
  mappingSchema,
  recordsFrom,
  valueAt,
  type Mapping,
  type MappedRecord,
} from './domain/mapping.js';
export {
  POLICIES,
  agrees,
  flatten,
  policyFor,
  reconcile,
  unflatten,
  type Policy,
  type Reconciliation,
  type Rule,
} from './domain/reconcile.js';
export { SOURCE_KINDS, isSourceKind, presetFor, type Preset, type SourceKind } from './sources/presets.js';
export { fetchRecords, resolveSource, sourceConfigSchema, type FetchDeps, type ResolvedSource } from './sources/fetch.js';
export { contractReport } from './jobs/contract-sweep.js';
export { dueSources } from './jobs/discovery-sweep.js';
import './jobs/discovery-sweep.js';
import './jobs/contract-sweep.js';
