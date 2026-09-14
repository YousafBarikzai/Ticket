/** MOD-13 Administration, configuration and marketplace — public interface. */
export { adminManifest } from './manifest.js';
export * as settingsService from './service/settings-service.js';
export { syncInstalledModules, listInstalledModules, listDeclaredSettings, listDeclaredFlags } from './service/settings-service.js';
