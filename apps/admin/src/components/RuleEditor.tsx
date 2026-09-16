'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, type RuleTestResult } from '@itsm/sdk';
import { Button, FormField, Input, Select, Textarea } from '@itsm/ui';
import { api } from '../client/api.js';
import { slugFor } from '../keys.js';
import {
  ACTION_TYPES,
  OPERATORS,
  emptyAction,
  isUnary,
  toAction,
  toExpression,
  type ActionDraft,
  type Condition,
  type Join,
  type Operator,
} from '../rules.js';

const STRATEGIES = ['round_robin', 'least_loaded', 'skill'];
const RECIPIENTS = ['requester', 'assignee', 'group', 'watchers'];

/**
 * Writing a rule.
 *
 * The field picker is populated from `/rules/facts` rather than from a list
 * kept here. The route's own comment asks for exactly that — "the list an
 * author sees is the list the validator enforces" — and a second copy in this
 * file would be a second thing to keep in step with the engine, which is how
 * an author ends up offered a fact that fails validation on save.
 *
 * The dry run is the part worth having. A rule is written against a desk
 * somebody else has been running for a year, and "what would this have done to
 * the last fifty tickets" is a question no amount of reading the conditions
 * answers. It writes nothing.
 */
export function RuleEditor({
  facts,
  events,
  existingKeys,
  drafts,
  publishedKeys,
}: {
  facts: readonly string[];
  events: readonly string[];
  existingKeys: readonly string[];
  drafts: readonly { key: string; name: string }[];
  publishedKeys: readonly string[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [event, setEvent] = useState(events[0] ?? 'ticket.created');
  const [join, setJoin] = useState<Join>('and');
  const [conditions, setConditions] = useState<Condition[]>([{ fact: '', operator: 'eq', value: '' }]);
  const [actions, setActions] = useState<ActionDraft[]>([emptyAction()]);
  const [order, setOrder] = useState('100');
  const [mode, setMode] = useState('continue');

  const [publishKey, setPublishKey] = useState('');
  const [testKey, setTestKey] = useState('');
  const [result, setResult] = useState<RuleTestResult | null>(null);

  const key = slugFor(name);
  const taken = key !== '' && existingKeys.includes(key);

  async function run(what: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(what);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function patchCondition(index: number, patch: Partial<Condition>): void {
    setConditions((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  function patchAction(index: number, patch: Partial<ActionDraft>): void {
    setActions((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  return (
    <section className="itsm-FieldEditor" aria-label="Write a rule">
      <h2>Write a rule</h2>

      <form
        aria-label="Create a rule"
        onSubmit={(event_) => {
          event_.preventDefault();
          void run(`Rule ${key} saved as a draft.`, async () => {
            await api.configure.rules.create({
              key,
              name: name.trim(),
              ...(description.trim() ? { description: description.trim() } : {}),
              event,
              conditions: toExpression(conditions, join),
              actions: actions.map(toAction),
              order: Number(order) || 100,
              mode,
            });
            setName('');
            setDescription('');
            setConditions([{ fact: '', operator: 'eq', value: '' }]);
            setActions([emptyAction()]);
          });
        }}
      >
        <FormField label="Name" hint="What this rule is for, in a few words.">
          {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        {name.trim() !== '' ? (
          <p className="itsm-FieldEditor__key">
            {key ? (
              taken ? (
                <>
                  <code>{key}</code> is already taken by another rule — try different wording.
                </>
              ) : (
                <>
                  Stored as <code>{key}</code>.
                </>
              )
            ) : (
              <>That name cannot make a key — try different wording.</>
            )}
          </p>
        ) : null}

        <FormField label="Description" hint="Optional. Why this rule exists, for whoever reads it next.">
          {(control) => <Textarea {...control} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </FormField>

        <FormField label="When" hint="The moment this rule is considered.">
          {(control) => (
            <Select
              {...control}
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              options={events.map((one) => ({ value: one, label: one }))}
            />
          )}
        </FormField>

        <fieldset className="itsm-RuleEditor__group">
          <legend>If</legend>
          <FormField label="Match" hint="How the conditions below combine.">
            {(control) => (
              <Select
                {...control}
                value={join}
                onChange={(e) => setJoin(e.target.value as Join)}
                options={[
                  { value: 'and', label: 'All of these' },
                  { value: 'or', label: 'Any of these' },
                ]}
              />
            )}
          </FormField>

          {conditions.map((condition, index) => (
            <div className="itsm-RuleEditor__row" key={index}>
              <FormField label={`Field ${index + 1}`}>
                {(control) => (
                  <Select
                    {...control}
                    value={condition.fact}
                    onChange={(e) => patchCondition(index, { fact: e.target.value })}
                    placeholder="Choose a field"
                    options={facts.map((fact) => ({ value: fact, label: fact }))}
                  />
                )}
              </FormField>
              <FormField label={`Test ${index + 1}`}>
                {(control) => (
                  <Select
                    {...control}
                    value={condition.operator}
                    onChange={(e) => patchCondition(index, { operator: e.target.value as Operator })}
                    options={OPERATORS.map((operator) => ({ value: operator.value, label: operator.label }))}
                  />
                )}
              </FormField>
              {isUnary(condition.operator) ? null : (
                <FormField label={`Value ${index + 1}`} hint="A number or true/false is sent as one.">
                  {(control) => (
                    <Input
                      {...control}
                      value={condition.value}
                      onChange={(e) => patchCondition(index, { value: e.target.value })}
                    />
                  )}
                </FormField>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConditions((rows) => [...rows, { fact: '', operator: 'eq', value: '' }])}
          >
            Add a condition
          </Button>
          <p className="itsm-Admin__note">
            With no field chosen this matches every time, which is what a rule with no conditions means.
          </p>
        </fieldset>

        <fieldset className="itsm-RuleEditor__group">
          <legend>Then</legend>
          {actions.map((action, index) => (
            <div className="itsm-RuleEditor__row" key={index}>
              <FormField label={`Do ${index + 1}`}>
                {(control) => (
                  <Select
                    {...control}
                    value={action.type}
                    onChange={(e) =>
                      patchAction(index, {
                        type: e.target.value as ActionDraft['type'],
                        value: e.target.value === 'setPriority' ? 'P3' : e.target.value === 'assignStrategy' ? 'round_robin' : '',
                      })
                    }
                    options={ACTION_TYPES.map((one) => ({ value: one.value, label: one.label }))}
                  />
                )}
              </FormField>

              {action.type === 'setPriority' ? (
                <FormField label="To">
                  {(control) => (
                    <Select
                      {...control}
                      value={action.value}
                      onChange={(e) => patchAction(index, { value: e.target.value })}
                      options={['P1', 'P2', 'P3', 'P4'].map((one) => ({ value: one, label: one }))}
                    />
                  )}
                </FormField>
              ) : action.type === 'assignStrategy' ? (
                <FormField label="Strategy">
                  {(control) => (
                    <Select
                      {...control}
                      value={action.value}
                      onChange={(e) => patchAction(index, { value: e.target.value })}
                      options={STRATEGIES.map((one) => ({ value: one, label: one.replace(/_/g, ' ') }))}
                    />
                  )}
                </FormField>
              ) : (
                <FormField
                  label={action.type === 'addTag' ? 'Tag' : action.type === 'setStatus' ? 'Status' : 'Template'}
                >
                  {(control) => (
                    <Input {...control} value={action.value} onChange={(e) => patchAction(index, { value: e.target.value })} />
                  )}
                </FormField>
              )}

              {action.type === 'sendNotification' ? (
                <FormField label="To">
                  {(control) => (
                    <Select
                      {...control}
                      value={action.to}
                      onChange={(e) => patchAction(index, { to: e.target.value })}
                      options={RECIPIENTS.map((one) => ({ value: one, label: one }))}
                    />
                  )}
                </FormField>
              ) : null}

              {action.type === 'setPriority' || action.type === 'setStatus' ? (
                <FormField
                  label="Reason"
                  hint={action.type === 'setPriority' ? 'Recorded on the ticket. Required.' : 'Optional.'}
                >
                  {(control) => (
                    <Input {...control} value={action.reason} onChange={(e) => patchAction(index, { reason: e.target.value })} />
                  )}
                </FormField>
              ) : null}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setActions((rows) => [...rows, emptyAction()])}>
            Add an action
          </Button>
        </fieldset>

        <FormField label="Order" hint="Rules for one event run lowest first.">
          {(control) => <Input {...control} type="number" value={order} onChange={(e) => setOrder(e.target.value)} />}
        </FormField>
        <FormField label="After this rule" hint="Whether later rules for the same event still run.">
          {(control) => (
            <Select
              {...control}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={[
                { value: 'continue', label: 'Carry on to the next rule' },
                { value: 'stop', label: 'Stop — no further rule runs for this event' },
              ]}
            />
          )}
        </FormField>

        <Button type="submit" disabled={busy || key === '' || taken}>
          Save as a draft
        </Button>
        <p className="itsm-Admin__note">A draft does nothing until it is published.</p>
      </form>

      <form
        aria-label="Try a rule against real tickets"
        onSubmit={(event_) => {
          event_.preventDefault();
          void run(`Dry run finished for ${testKey}.`, async () => {
            setResult(await api.configure.rules.test(testKey, 50));
          });
        }}
      >
        <h3>Try it first</h3>
        <p className="itsm-Admin__note">
          Runs the rule against the fifty most recent tickets and reports what it would have changed. Writes nothing.
        </p>
        <FormField label="Rule">
          {(control) => (
            <Select
              {...control}
              value={testKey}
              onChange={(e) => {
                setTestKey(e.target.value);
                setResult(null);
              }}
              placeholder="Choose a rule"
              options={[...drafts.map((one) => ({ value: one.key, label: `${one.name} (draft)` })), ...publishedKeys.map((one) => ({ value: one, label: one }))]}
            />
          )}
        </FormField>
        <Button type="submit" disabled={busy || testKey === ''}>
          Dry run
        </Button>

        {result ? (
          <div className="itsm-RuleEditor__result" role="status">
            <p>
              {result.wouldChange.length === 0
                ? `Matched none of the ${result.sampled} tickets sampled.`
                : `Would have changed ${result.wouldChange.length} of the ${result.sampled} tickets sampled.`}
            </p>
            {result.errors.length > 0 ? (
              <ul>
                {result.errors.map((failure) => (
                  <li key={`${failure.ruleKey}:${failure.message}`}>{failure.message}</li>
                ))}
              </ul>
            ) : null}
            <ul>
              {result.wouldChange.slice(0, 10).map((change) => (
                <li key={change.ticketId}>
                  <code>{change.number}</code> {change.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>

      <form
        aria-label="Publish a rule"
        onSubmit={(event_) => {
          event_.preventDefault();
          void run(`${publishKey} is running.`, async () => {
            await api.configure.rules.publish(publishKey);
            setPublishKey('');
          });
        }}
      >
        <h3>Publish</h3>
        {drafts.length === 0 ? (
          <p className="itsm-Admin__note">No drafts waiting.</p>
        ) : (
          <>
            <FormField label="Draft" hint="Once published this runs on every matching ticket.">
              {(control) => (
                <Select
                  {...control}
                  value={publishKey}
                  onChange={(e) => setPublishKey(e.target.value)}
                  placeholder="Choose a draft"
                  options={drafts.map((one) => ({ value: one.key, label: one.name }))}
                />
              )}
            </FormField>
            <Button type="submit" disabled={busy || publishKey === ''}>
              Publish
            </Button>
          </>
        )}
      </form>

      {error ? (
        <p className="itsm-FieldEditor__error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="itsm-FieldEditor__done" role="status">
          {done}
        </p>
      ) : null}

      <p className="itsm-Admin__note">
        Six of the eleven actions the engine supports are not offered here — setting a field or category, assigning to
        a named group, adding a watcher, linking a duplicate and starting a workflow all take an identifier this
        console has no list to offer, and a box asking for a UUID is not a builder. They are reachable through the API.
        Editing a published rule and archiving one are API-only for now too.
      </p>
    </section>
  );
}
