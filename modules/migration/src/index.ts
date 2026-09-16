/** MOD-24 Migration — public interface. */
export { migrationManifest } from './manifest.js';
export * as jobService from './service/job-service.js';
export * as importers from './service/importers.js';
export {
  MAX_FILE_BYTES,
  cancelJob,
  commitJob,
  createJob,
  createJobSchema,
  deleteMapping,
  describe,
  getJob,
  listJobs,
  listMappings,
  listRecords,
  mappingDocumentSchema,
  runJob,
  saveMapping,
  storeFile,
  sweepFiles,
  type CreateJobInput,
  type RunResult,
} from './service/job-service.js';
export { applyRow, findLink, remember, type Applied, type ImportOptions, type Outcome } from './service/importers.js';
export {
  ENTITIES,
  FIELD_CATALOGUE,
  PRIORITIES,
  TICKET_STATES,
  TICKET_TYPES,
  commentsMappingSchema,
  looksLikeEmail,
  mapRecord,
  mappingSchema,
  parseDate,
  parseMapping,
  slugify,
  type Entity,
  type FieldDefinition,
  type MappedComment,
  type MappedRecord,
  type Mapping,
  type MappingInput,
  type Reference,
} from './domain/mapping.js';
export { SOURCE_KINDS, describeSources, isSourceKind, presetFor, type Paging, type Preset, type SourceKind } from './domain/presets.js';
export { MAX_RECORDS, fetchRecords, pagingSchema, readFileRecords, resolveSource, sourceConfigSchema, type FetchDeps, type ResolvedSource, type SourceConfig } from './sources/fetch.js';
import './jobs/index.js';
import './notifications.js';
