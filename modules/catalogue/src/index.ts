/** MOD-05 Service catalogue, with MOD-02's forms — public interface. */
export { catalogueManifest } from './manifest.js';
export * as catalogueService from './service/catalogue-service.js';
export * as formService from './service/form-service.js';
export {
  browse,
  openRequest,
  submitRequest,
  createService,
  createRequestType,
  publishRequestType,
  updateService,
  updateRequestType,
  serviceSchema,
  requestTypeSchema,
  serviceUpdateSchema,
  requestTypeUpdateSchema,
} from './service/catalogue-service.js';
export {
  createForm,
  publishForm,
  updateForm,
  createFormSchema,
  updateFormSchema,
  formDocumentSchema,
  validateSubmission,
  assertDocumentIsCoherent,
  currentVersion,
} from './service/form-service.js';
export { isEntitled, entitlementContext, ENTITLEMENT_FACTS, type RequesterFacts } from './domain/entitlement.js';
export { seedCatalogueDefaults } from './seed/defaults.js';
import './handlers/index.js';
