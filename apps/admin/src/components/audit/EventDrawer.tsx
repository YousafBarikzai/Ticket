'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, DescriptionList, EmptyState, IconButton, InlineAlert, RelativeTime, SkeletonText, useItsm, type Problem } from '@itsm/ui';
import { Sheet } from '@itsm/ui/overlays';
import { problemFrom } from '../../problem.js';
import { JsonDiff } from '../JsonDiff.js';
import { JsonView } from '../JsonView.js';
import { PersonCell } from '../PersonCell.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { actionLabel, targetNoun, type AuditChange, type AuditRowView } from './presentation.js';

/**
 * One audit event (`?open=event:<seq>`, SPEC §6.1): who did what to what,
 * when, why, the correlation id that ties it to the request that caused it,
 * and a diff of what changed.
 *
 * The event's before and after come for this event alone — from the server
 * on a hard load, otherwise one request for exactly this event — so opening
 * a drawer never puts a page of payloads in the browser.
 */
export interface EventDrawerProps {
  /** The open event's seq, or null when closed. */
  readonly seq: string | null;
  /** The row, when the event is on this page (or came with the hard load). */
  readonly row: AuditRowView | undefined;
  /** Fetches this event's before and after; null when the log has no such event. */
  load(seq: string): Promise<AuditChange | null>;
  readonly initial?: AuditChange;
  onClose(): void;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly change: AuditChange }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly problem: Problem };

function present(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * What changed, in the shape the event has: a diff when there is a before
 * and an after; what was recorded when there was nothing before (a
 * creation); what went when there is nothing after (a deletion); a sentence
 * when the event carries neither.
 */
function Changes({ change, seq }: { readonly change: AuditChange; readonly seq: string }): ReactNode {
  const before = present(change.before);
  const after = present(change.after);
  if (before && after) return <JsonDiff before={change.before} after={change.after} label={`Changes recorded by event ${seq}`} />;
  if (after) {
    return (
      <>
        <p className="app-AuditEvent__quiet">Nothing existed before this event; this is what it recorded.</p>
        <JsonView value={change.after} label="What it recorded" />
      </>
    );
  }
  if (before) {
    return (
      <>
        <p className="app-AuditEvent__quiet">Nothing remained after this event; this is what it removed.</p>
        <JsonView value={change.before} label="What it removed" />
      </>
    );
  }
  return <p className="app-AuditEvent__quiet">This event records that something happened; it carries no before or after.</p>;
}

export function EventDrawer({ seq, row, load, initial, onClose }: EventDrawerProps): ReactNode {
  const { Link } = useItsm();
  const [state, setState] = useState<State>(() => (initial && initial.seq === seq ? { kind: 'ready', change: initial } : { kind: 'loading' }));
  const [copied, setCopied] = useState(false);
  const loader = useRef(load);
  loader.current = load;

  const fetchChange = useCallback(async (wanted: string) => {
    setState({ kind: 'loading' });
    try {
      const change = await loader.current(wanted);
      setState(change ? { kind: 'ready', change } : { kind: 'missing' });
    } catch (error) {
      setState({ kind: 'failed', problem: problemFrom(error) });
    }
  }, []);

  useEffect(() => {
    setCopied(false);
    if (seq === null) return;
    if (initial && initial.seq === seq) {
      setState({ kind: 'ready', change: initial });
      return;
    }
    void fetchChange(seq);
  }, [seq, initial, fetchChange]);

  const copy = (value: string): void => {
    void navigator.clipboard?.writeText(value).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  const missing = seq !== null && (state.kind === 'missing' || (state.kind !== 'loading' && !row));

  return (
    <Sheet
      open={seq !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      title={row ? row.sentence : seq ? `Event #${seq}` : 'Event'}
      {...(row ? { description: `${row.dayLabel} at ${row.timeLabel}` } : {})}
      {...(seq ? { headerMeta: <span className="app-Audit__seqPill">#{seq}</span> } : {})}
    >
      {seq === null ? null : missing ? (
        <EmptyState
          size="sm"
          title="That event isn’t in this workspace’s log"
          description="The link may be from another workspace, or mistyped."
          action={{ id: 'close', label: 'Close', variant: 'secondary' }}
          onAction={() => onClose()}
        />
      ) : (
        <div className="app-AuditEvent">
          {row ? (
            <DescriptionList
              layout="inline"
              dense
              items={[
                { id: 'when', label: 'When', value: <RelativeTime date={row.occurredAt} mode="absolute" absoluteStyle="datetime" /> },
                {
                  id: 'who',
                  label: 'Who',
                  value: row.actorId ? <PersonCell person={{ id: row.actorId, name: row.actorKnown ? row.actorName : null }} size="xs" /> : row.actorName,
                },
                {
                  id: 'action',
                  label: 'Action',
                  value: (
                    <span className="app-AuditEvent__stack">
                      <span>{actionLabel(row.action)}</span>
                      <TechnicalKey value={row.action} label="the action key" />
                    </span>
                  ),
                },
                {
                  id: 'target',
                  label: 'Target',
                  value: (
                    <span className="app-AuditEvent__stack">
                      <span>
                        {row.target ? (
                          row.target.href ? (
                            <Link href={row.target.href} className="app-Audit__link">
                              {row.target.label}
                            </Link>
                          ) : (
                            <span data-technical={row.target.technical ? '' : undefined} className="app-Audit__target">
                              {row.target.label}
                            </span>
                          )
                        ) : row.targetHref ? (
                          <Link href={row.targetHref} className="app-Audit__link">
                            Open the {targetNoun(row.targetType)}
                          </Link>
                        ) : (
                          'Not named'
                        )}
                        <span className="app-AuditEvent__quiet"> · {targetNoun(row.targetType)}</span>
                      </span>
                      <TechnicalKey value={row.targetId} label="the target id" />
                    </span>
                  ),
                },
                { id: 'reason', label: 'Reason', value: row.reason ?? '', ...(row.reason ? {} : { hint: 'None was given.' }) },
                {
                  id: 'correlation',
                  label: 'Correlation id',
                  value: row.correlationId ? (
                    <span className="app-AuditEvent__copy">
                      <code className="app-AuditEvent__mono">{row.correlationId}</code>
                      <IconButton
                        icon={copied ? 'check' : 'copy'}
                        label={copied ? 'Copied the correlation id' : 'Copy the correlation id'}
                        size="sm"
                        variant="ghost"
                        onClick={() => copy(row.correlationId!)}
                      />
                    </span>
                  ) : (
                    ''
                  ),
                  hint: 'Every event caused by the same request shares it.',
                },
              ]}
            />
          ) : null}

          <section className="app-AuditEvent__changes" aria-labelledby="app-audit-changes">
            <h3 id="app-audit-changes" className="app-AuditEvent__heading">
              What changed
            </h3>
            {state.kind === 'loading' ? (
              <SkeletonText lines={4} />
            ) : state.kind === 'failed' ? (
              <InlineAlert tone="danger">
                <span className="app-AuditEvent__retry">
                  Couldn’t load what changed.
                  <Button size="sm" variant="ghost" onClick={() => void fetchChange(seq)}>
                    Try again
                  </Button>
                </span>
              </InlineAlert>
            ) : state.kind === 'ready' ? (
              <Changes change={state.change} seq={seq} />
            ) : null}
          </section>
        </div>
      )}
    </Sheet>
  );
}
