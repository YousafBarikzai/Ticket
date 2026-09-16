import { getSetting, logger, maskRecord, type TenantContext } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { search } from '@itsm/module-search';
import { knownErrorService } from '@itsm/module-problem';
import { definitionFor, type AssembledContext, type Capability, type Evidence } from '../domain/capabilities.js';

/**
 * Building what the model is shown.
 *
 * The rule that shapes every line of this file: **the AI never sees more than
 * the actor** (doc 13 §1). So nothing here reads a table directly. The ticket
 * and its conversation come from MOD-04's own timeline, which already drops
 * internal notes for anybody without the permission to read them; articles and
 * tickets come from MOD-09's search, which filters on the actor's visibility
 * *before* ranking; known errors come from MOD-08-E2, which checks
 * `problem.read`. Every one of those checks is the owning module's, made once,
 * rather than re-implemented here where it would drift.
 *
 * Restricted fields are then removed by the classification registry, because
 * "this person may see the ticket" and "this field may be sent to a provider"
 * are different questions.
 */

const MAX_COMMENTS = 30;
const EXTRACT_CHARS = 400;

/** An agent who cannot read problems simply has no known errors in evidence. */
async function knownErrors(ctx: TenantContext, query: string, limit: number): Promise<Evidence[]> {
  try {
    const rows = await knownErrorService.listKnownErrors(ctx, query);
    return rows.slice(0, limit).map((row) => ({
      kind: 'known-error' as const,
      id: row.id,
      title: row.problem?.title ?? row.symptom.slice(0, 120),
      ref: row.problem?.number ?? row.id,
      extract: `${row.symptom}\nWorkaround: ${row.workaround}`.slice(0, EXTRACT_CHARS),
    }));
  } catch (error) {
    // Not an error worth failing a suggestion over: it is the permission
    // model doing its job, and the answer is simply built from less.
    logger.debug('known errors were not readable for this actor', { error: (error as Error).message });
    return [];
  }
}

async function fromSearch(
  ctx: TenantContext,
  query: string,
  type: 'knowledge' | 'ticket',
  limit: number,
  excludeId?: string,
): Promise<Evidence[]> {
  if (limit <= 0) return [];
  const hits = await search(ctx, { query, types: [type], limit: limit + 1 });
  return hits
    .filter((hit) => hit.entityId !== excludeId)
    .slice(0, limit)
    .map((hit) => ({
      kind: type === 'knowledge' ? ('article' as const) : ('ticket' as const),
      id: hit.entityId,
      title: hit.title,
      ref: String(hit.facets.key ?? hit.facets.number ?? hit.entityId),
      extract: hit.snippet.slice(0, EXTRACT_CHARS),
    }));
}

/**
 * The evidence a capability may gather, under this actor's permissions.
 *
 * The query is the ticket's own title. Deliberately not the whole ticket: a
 * retrieval query built from a long thread matches the thread rather than the
 * problem, which is the most common way a hybrid retriever quietly stops
 * retrieving anything useful.
 */
export async function gatherEvidence(
  ctx: TenantContext,
  capability: Capability,
  ticket: { id: string; title: string },
): Promise<Evidence[]> {
  const definition = definitionFor(capability);
  if (definition.retrieves.length === 0) return [];

  const perKind = Math.max(1, Math.floor(definition.evidenceLimit / definition.retrieves.length));
  const found: Evidence[] = [];

  for (const kind of definition.retrieves) {
    if (kind === 'article') found.push(...(await fromSearch(ctx, ticket.title, 'knowledge', perKind)));
    if (kind === 'ticket') found.push(...(await fromSearch(ctx, ticket.title, 'ticket', perKind, ticket.id)));
    if (kind === 'known-error') found.push(...(await knownErrors(ctx, ticket.title, perKind)));
  }
  return found.slice(0, definition.evidenceLimit);
}

export interface Assembled {
  context: AssembledContext;
  evidence: Evidence[];
  ticket: { id: string; number: string; title: string; status: string };
}

export async function assemble(ctx: TenantContext, capability: Capability, ticketId: string): Promise<Assembled> {
  const timeline = await ticketService.getTimeline(ctx, ticketId);
  const ticket = timeline.ticket as unknown as Record<string, unknown>;

  // Visible to this person is not the same as safe to send to a provider.
  const masked = maskRecord(ctx, 'ticket', ticket);

  const comments = timeline.entries
    .filter((entry): entry is Extract<typeof entry, { kind: 'comment' }> => entry.kind === 'comment')
    .slice(-MAX_COMMENTS)
    .map((entry) => {
      const comment = entry.comment as unknown as { body: string; isInternal?: boolean; internal?: boolean; authorId: string | null; createdAt: Date };
      return {
        author: comment.authorId ?? 'unknown',
        internal: Boolean(comment.isInternal ?? comment.internal),
        body: comment.body,
        at: comment.createdAt.toISOString(),
      };
    });

  const evidence = await gatherEvidence(ctx, capability, {
    id: String(ticket.id),
    title: String(ticket.title ?? ''),
  });

  const [tone, language] = await Promise.all([
    getSetting<string>(ctx, 'ai.tone').catch(() => 'plain'),
    getSetting<string>(ctx, 'ai.language').catch(() => 'English'),
  ]);

  return {
    context: {
      ticket: {
        title: masked.title ?? '',
        description: masked.description ?? '(no description)',
        type: masked.type ?? 'incident',
        status: masked.status ?? 'new',
        priority: masked.priority ?? 'P3',
        createdAt: ticket.createdAt instanceof Date ? ticket.createdAt.toISOString() : String(ticket.createdAt ?? ''),
      },
      requester: { displayName: String(timeline.ticket.requesterId ?? 'the requester') },
      comments,
      evidence,
      tone,
      language,
    },
    evidence,
    ticket: {
      id: String(ticket.id),
      number: String(ticket.number),
      title: String(ticket.title ?? ''),
      status: String(ticket.status),
    },
  };
}

/**
 * The context as the template sees it.
 *
 * Lists are rendered into strings here rather than looped over in the
 * template, because the template language is paths and nothing else — the same
 * decision the workflow engine made, for the same reason (ADR-0021): a second
 * half-language inside a string becomes a programming language nobody meant to
 * write. It also means the exact text a model was shown is a string somebody
 * can read in the job row, rather than something reconstructed later.
 */
export function renderable(assembled: AssembledContext): Record<string, unknown> {
  const conversation =
    assembled.comments.length > 0
      ? assembled.comments.map((comment) => `- ${comment.internal ? '[internal] ' : ''}${comment.body}`).join('\n')
      : '- (no replies yet)';

  const evidenceList =
    assembled.evidence.length > 0
      ? assembled.evidence.map((one) => `- ${one.title} (${one.ref}): ${one.extract}`).join('\n')
      : '- (nothing found)';

  return {
    ticket: assembled.ticket,
    requester: assembled.requester,
    conversation,
    evidenceList,
    tone: assembled.tone,
    language: assembled.language,
  };
}
