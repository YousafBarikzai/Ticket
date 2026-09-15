import { loadConfig, logger } from '@itsm/platform';
import { registerTransport, type DeliveryTransport } from '@itsm/module-notifications';

/**
 * Delivery transports (docs/architecture/07 §6).
 *
 * The email provider sits behind an interface so that the choice of provider
 * (open decision OD-03) is a deployment setting rather than a code change, and
 * so that a tenant whose data-protection assessment rejects one provider can be
 * given another.
 */

/** Logs instead of sending. The default locally and in preview environments. */
const logTransport: DeliveryTransport = {
  channel: 'email',
  async send({ to, subject, body }) {
    logger.info('email (not sent: log transport)', { to, subject, preview: body.slice(0, 200) });
    return { providerRef: null };
  },
};

/** SMTP, used against Mailpit locally and a real relay in deployed environments. */
function smtpTransport(url: string): DeliveryTransport {
  return {
    channel: 'email',
    async send({ to, subject, body }) {
      const nodemailer = await import('nodemailer').catch(() => null);
      if (!nodemailer) {
        logger.warn('nodemailer is not installed; falling back to the log transport');
        return logTransport.send({ to, subject, body });
      }
      const transporter = nodemailer.default.createTransport(url);
      const info = await transporter.sendMail({
        from: loadConfig().EMAIL_FROM,
        to,
        subject: subject ?? 'Service desk update',
        text: body,
      });
      return { providerRef: info.messageId ?? null };
    },
  };
}

export function registerTransports(): void {
  const config = loadConfig();
  if (config.EMAIL_TRANSPORT === 'smtp' && config.SMTP_URL) {
    registerTransport(smtpTransport(config.SMTP_URL));
    logger.info('email transport registered', { transport: 'smtp' });
    return;
  }
  registerTransport(logTransport);
  logger.info('email transport registered', { transport: 'log' });
}
