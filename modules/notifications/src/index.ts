/** MOD-11 Notifications, collaboration and communications — public interface. */
export { notificationsManifest } from './manifest.js';
export * as notificationService from './service/notification-service.js';
export { registerTransport, registeredTransports, type DeliveryTransport } from './service/notification-service.js';
export { renderTemplate, placeholdersIn, validateTemplate } from './service/template.js';
export { seedNotificationDefaults } from './seed/templates.js';
import './handlers/index.js';
