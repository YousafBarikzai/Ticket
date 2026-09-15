/** MOD-15 Security, privacy, audit and resilience — public interface. */
export { securityManifest } from './manifest.js';
export * as auditService from './service/audit-service.js';
export { scanAttachment, setScanner, setObjectReader, developmentScanner, type Scanner } from './jobs/scan.js';
export { seedClassifications, registerDefaultClassifications, DEFAULT_CLASSIFICATIONS } from './seed/classifications.js';
import './handlers/index.js';
import './jobs/scan.js';
