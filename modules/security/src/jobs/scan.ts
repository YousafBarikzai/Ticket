import { createHash } from 'node:crypto';
import { defineJob, transaction, publish, recordAudit, logger, metrics, type TenantContext } from '@itsm/platform';
import { events } from '@itsm/contracts';
import { raiseAlert } from '../service/audit-service.js';

/**
 * Attachment scanning (ADR-0016).
 *
 * An attachment is invisible until this job marks it clean, so there is never a
 * window in which a malicious file can be downloaded. The scanner itself is
 * behind an interface: in development it is a signature check that recognises
 * the EICAR test file, and in deployed environments it is ClamAV over the
 * private network.
 */
export interface Scanner {
  name: string;
  scan(bytes: Buffer, filename: string): Promise<{ verdict: 'clean' | 'infected'; signature?: string }>;
}

/** EICAR is the industry-standard harmless test file; recognising it proves the path works. */
const EICAR_SHA256 = '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f';

export const developmentScanner: Scanner = {
  name: 'development-signature',
  async scan(bytes) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest === EICAR_SHA256) return { verdict: 'infected', signature: 'EICAR-Test-File' };
    return { verdict: 'clean' };
  },
};

let scanner: Scanner = developmentScanner;

export function setScanner(next: Scanner): void {
  scanner = next;
}

/** Reads the uploaded object. Replaced by the storage client when S3 is wired in. */
export type ObjectReader = (objectKey: string) => Promise<Buffer>;

let readObject: ObjectReader = async () => Buffer.alloc(0);

export function setObjectReader(reader: ObjectReader): void {
  readObject = reader;
}

export async function scanAttachment(ctx: TenantContext, attachmentId: string): Promise<'clean' | 'infected' | 'error'> {
  const attachment = await transaction(ctx, (tx) => tx.attachment.findFirst({ where: { id: attachmentId } }));
  if (!attachment) {
    logger.warn('attachment to scan no longer exists', { attachmentId });
    return 'error';
  }
  if (attachment.scanStatus !== 'pending') return attachment.scanVerdict as 'clean' | 'infected';

  let verdict: 'clean' | 'infected' | 'error' = 'error';
  let signature: string | undefined;
  try {
    const bytes = await readObject(attachment.objectKey);
    const result = await scanner.scan(bytes, attachment.filename);
    verdict = result.verdict;
    signature = result.signature;
  } catch (error) {
    logger.error('attachment scan failed', { attachmentId, error: (error as Error).message });
    verdict = 'error';
  }

  await transaction(ctx, async (tx) => {
    await tx.attachment.update({
      where: { id: attachmentId },
      data: { scanStatus: verdict === 'clean' ? 'clean' : verdict, scanVerdict: signature ?? verdict, scannedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: 'ticket.attachment.scanned',
      targetType: 'attachment',
      targetId: attachmentId,
      after: { verdict, signature: signature ?? null },
    });
    const ticket = await tx.ticket.findFirst({ where: { id: attachment.ticketId } });
    await publish(tx, ctx, {
      definition: events.ticketAttachmentScanned,
      aggregateId: attachment.ticketId,
      payload: {
        ticketId: attachment.ticketId,
        number: ticket?.number ?? '',
        attachmentId,
        verdict,
      },
    });
  });

  if (verdict === 'infected') {
    await raiseAlert(ctx, {
      type: 'attachment.infected',
      severity: 'high',
      details: { attachmentId, filename: attachment.filename, signature: signature ?? 'unknown' },
    });
  }

  metrics.increment('attachments_scanned_total', { verdict });
  return verdict;
}

defineJob<{ attachmentId: string }>('scan', 'attachment.scan', async (payload, { ctx }) => {
  await scanAttachment(ctx, payload.attachmentId);
});
