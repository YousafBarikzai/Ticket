import { cache, subscriber, tenantKey } from './redis.js';
import type { TenantContext } from './context.js';
import { logger } from './telemetry.js';

/**
 * Realtime notices (ADR-0015).
 *
 * The stream carries only "this changed" notices; clients refetch through the
 * API, so nothing permission-sensitive travels over the channel and no
 * additional filtering is needed on the wire.
 */
export interface ChangeNotice {
  entity: string;
  id: string;
  version?: number;
  action: string;
  at: string;
}

export function topicForUser(tenantId: string, userId: string): string {
  return tenantKey(tenantId, 'sse', 'user', userId);
}

export function topicForEntity(tenantId: string, entity: string, id: string): string {
  return tenantKey(tenantId, 'sse', entity, id);
}

export async function publishNotice(ctx: TenantContext, topics: string[], notice: Omit<ChangeNotice, 'at'>): Promise<void> {
  const payload = JSON.stringify({ ...notice, at: new Date().toISOString() });
  try {
    const redis = cache();
    await Promise.all(topics.map((topic) => redis.publish(topic, payload)));
  } catch (error) {
    // A realtime nudge is a convenience: never fail a write because it did not send.
    logger.debug('realtime notice not published', { error: (error as Error).message });
  }
}

export interface Subscription {
  close(): Promise<void>;
}

export async function subscribeTopics(topics: string[], onNotice: (topic: string, notice: ChangeNotice) => void): Promise<Subscription> {
  const connection = subscriber().duplicate();
  await connection.subscribe(...topics);
  connection.on('message', (topic, message) => {
    try {
      onNotice(topic, JSON.parse(message) as ChangeNotice);
    } catch {
      logger.debug('unparseable realtime notice', { topic });
    }
  });
  return {
    async close() {
      await connection.quit().catch(() => undefined);
    },
  };
}
