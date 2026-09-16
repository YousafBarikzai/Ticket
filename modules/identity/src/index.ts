/** MOD-01 Identity, organisations and access — public interface. */
export { identityManifest } from './manifest.js';
export * as userService from './service/user-service.js';
export { loadActor, resolveActor, type ResolvedActor } from './service/permission-service.js';
export { seedSystemRoles, SYSTEM_ROLES } from './seed/roles.js';
export * as scimService from './scim/scim-service.js';
export * as scimTokenService from './scim/token-service.js';
export { ScimError, scimErrorBody, SCIM_ERROR_SCHEMA, type ScimType } from './scim/errors.js';
export { parseFilter, FILTERABLE, type Filter } from './scim/filter.js';
export { normalisePatch, memberIds, asBoolean, type Operation, type PatchOp } from './scim/patch.js';
export {
  USER_SCHEMA,
  GROUP_SCHEMA,
  LIST_SCHEMA,
  PATCH_SCHEMA,
  fromScimUser,
  fromScimGroup,
  toScimUser,
  toScimGroup,
  listResponse,
  serviceProviderConfig,
  resourceTypes,
  type ScimUserInput,
  type ScimGroupInput,
} from './scim/resources.js';
export { pageSchema, roleMappingsSchema, MAX_PAGE, type Location } from './scim/scim-service.js';
export { SCIM_PERMISSIONS, ROTATION_OVERLAP_HOURS, slugOf } from './scim/token-service.js';
