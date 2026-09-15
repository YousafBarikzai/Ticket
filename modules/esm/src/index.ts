/** MOD-22 Enterprise service management packs — public interface. */
export { esmManifest } from './manifest.js';
export * as packService from './service/pack-service.js';
export {
  applyUpgrade,
  describePack,
  installPack,
  listPacks,
  previewInstall,
  previewUpgrade,
  upgradeInputSchema,
  type InstallPreview,
  type InstallResult,
  type PackSummary,
  type UpgradeInput,
  type UpgradePreview,
  type UpgradeResult,
} from './service/pack-service.js';
export {
  KIND_ORDER,
  PACK_KINDS,
  entriesOf,
  hashOf,
  packSchema,
  selectorOf,
  shapeOf,
  type Pack,
  type PackDefinition,
  type PackEntry,
  type PackKind,
} from './domain/pack.js';
export {
  DECLINABLE,
  OUTSTANDING,
  TAKEABLE,
  countByState,
  diffPack,
  hasOutstanding,
  type DiffLine,
  type InstalledItem,
  type ItemState,
} from './domain/diff.js';
export { ALL_PACKS, packFor } from './packs/index.js';
import './handlers/index.js';
