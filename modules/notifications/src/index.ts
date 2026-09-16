/** MOD-11 Notifications, collaboration and communications — public interface. */
export { notificationsManifest } from './manifest.js';
export * as notificationService from './service/notification-service.js';
export * as preferenceService from './service/preference-service.js';
export { registerTransport, registeredTransports, transportFor, type DeliveryTransport } from './service/notification-service.js';
export { NOTIFYING_EVENTS, isNotifiable, assertNotifiable } from './domain/notifying-events.js';
export { renderTemplate, placeholdersIn, validateTemplate } from './service/template.js';
export { preferenceSchema, type PreferenceInput } from './service/preference-service.js';
export {
  decideDelivery,
  inQuietHours,
  quietHoursEnd,
  nextDigestBoundary,
  type DeliveryDecision,
  type DigestMode,
  type QuietHours,
} from './domain/delivery-window.js';
export { seedNotificationDefaults, registerNotificationPack, registeredPacks, type NotificationPack } from './seed/templates.js';
import './handlers/index.js';
