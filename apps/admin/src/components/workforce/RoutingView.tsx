'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { RoutingExplanation, RoutingPolicy, RoutingStrategy } from '@itsm/sdk';
import { Button, Card, FormField, InlineAlert, Input, NumberField, RadioGroup, Select, StatusPill, Switch, type Problem } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { STRATEGY_WORDS, explanationSentence, rejectionSentence } from './presentation.js';
import type { WorkforceHeader } from './types.js';

export interface RoutingTeam {
  readonly value: string;
  readonly label: string;
}

/**
 * Workforce › Routing (SPEC §6.1; A6): how each team's tickets find a
 * person, and the question the old page could only point at — "why did this
 * ticket go to nobody?".
 *
 * The team is in the URL (`?team=<id>`) and read on the server. Its policy is
 * edited in place by people who manage the workforce; the explainer
 * rehearses a routing decision without assigning anything, for the next
 * ticket or for one by number, and says who would take it, in what order the
 * rest come, and why each of the others cannot.
 */
export function RoutingView({
  header,
  teams,
  teamId,
  policy,
  problem,
  canManage,
}: {
  readonly header: WorkforceHeader;
  readonly teams: readonly RoutingTeam[];
  readonly teamId: string;
  /** Null when it could not be read. */
  readonly policy: RoutingPolicy | null;
  readonly problem?: Problem;
  readonly canManage: boolean;
}): ReactNode {
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  const team = teams.find((entry) => entry.value === teamId);

  return (
    <div className="app-Page app-Workforce">
      <PageHeader title="Workforce" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
      <div className="app-Routing__team" aria-busy={switching || undefined}>
        <FormField label="Team" layout="inline">
          <Select
            value={teamId}
            options={teams}
            onChange={(event) => {
              const next = event.currentTarget.value;
              startSwitch(() => router.replace(`/workforce/routing?team=${encodeURIComponent(next)}`, { scroll: false }));
            }}
          />
        </FormField>
      </div>
      {policy ? (
        <PolicyCard key={`${teamId}:${JSON.stringify(policy)}`} teamId={teamId} teamName={team?.label ?? 'this team'} policy={policy} canManage={canManage} />
      ) : (
        <Card title="How tickets are assigned" {...(problem ? { problem } : {})} />
      )}
      <ExplainCard key={teamId} teamId={teamId} teamName={team?.label ?? 'this team'} />
    </div>
  );
}

const STRATEGIES: readonly RoutingStrategy[] = ['least_loaded', 'round_robin', 'skill'];

function PolicyCard({ teamId, teamName, policy, canManage }: { readonly teamId: string; readonly teamName: string; readonly policy: RoutingPolicy; readonly canManage: boolean }): ReactNode {
  const [strategy, setStrategy] = useState<RoutingStrategy>(policy.strategy);
  const [capacity, setCapacity] = useState<number | null>(policy.defaultCapacity);
  const [requireSkill, setRequireSkill] = useState(policy.requireSkill);
  const [allowOffShift, setAllowOffShift] = useState(policy.allowOffShift);
  const online = useOnline();
  const dirty =
    strategy !== policy.strategy || capacity !== policy.defaultCapacity || requireSkill !== policy.requireSkill || allowOffShift !== policy.allowOffShift;

  const save = useMutation(
    () => api.observe.queues.setRouting(teamId, { strategy, defaultCapacity: capacity ?? policy.defaultCapacity, requireSkill, allowOffShift }),
    { success: `Routing saved for ${teamName}`, failure: `Couldn’t save routing for ${teamName}` },
  );

  const blocked = !online ? 'You’re offline — changes can’t be saved.' : capacity === null ? 'Enter a capacity from 1 to 1000.' : undefined;

  return (
    <Card
      title="How tickets are assigned"
      meta={<StatusPill size="sm" tone={policy.source === 'team' ? 'info' : 'neutral'} label={policy.source === 'team' ? 'Set for this team' : 'Desk default'} />}
    >
      <div className="app-Routing__policy">
        {policy.source === 'tenant' ? (
          <p className="app-Routing__note">{teamName} follows the desk’s defaults{canManage ? ' until you save its own.' : '.'}</p>
        ) : null}
        <RadioGroup<RoutingStrategy>
          label="Strategy"
          variant="cards"
          columns={3}
          value={strategy}
          onChange={canManage ? setStrategy : () => undefined}
          options={STRATEGIES.map((value) => ({
            value,
            label: STRATEGY_WORDS[value].label,
            description: STRATEGY_WORDS[value].description,
            disabled: !canManage && value !== strategy,
          }))}
        />
        <div className="app-Routing__settings">
          <FormField label="Default capacity" hint="Open tickets one person holds before routing passes them by, unless they set their own.">
            <NumberField value={capacity} min={1} max={1000} unit="tickets" onChange={setCapacity} {...(canManage ? {} : { readOnly: true })} />
          </FormField>
          <Switch
            label="Only people with the ticket’s skills"
            description="A ticket that needs a skill waits rather than going to someone without it."
            checked={requireSkill}
            disabled={!canManage}
            onChange={setRequireSkill}
          />
          <Switch
            label="Include people who are off shift"
            description="By default, routing only picks people whose shift is running."
            checked={allowOffShift}
            disabled={!canManage}
            onChange={setAllowOffShift}
          />
        </div>
        {canManage && dirty ? (
          <div className="app-WorkforceActions">
            <Button
              variant="ghost"
              onClick={() => {
                setStrategy(policy.strategy);
                setCapacity(policy.defaultCapacity);
                setRequireSkill(policy.requireSkill);
                setAllowOffShift(policy.allowOffShift);
              }}
            >
              Discard
            </Button>
            <Button variant="primary" loading={save.pending} onClick={() => void save.run()} {...(blocked ? { disabledReason: blocked } : {})}>
              Save routing
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

interface Explained {
  readonly result: RoutingExplanation;
  readonly names: Readonly<Record<string, string>>;
  readonly ticket: string | null;
}

function ExplainCard({ teamId, teamName }: { readonly teamId: string; readonly teamName: string }): ReactNode {
  const [number, setNumber] = useState('');
  const [explained, setExplained] = useState<Explained | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);

  const explain = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      const wanted = number.trim();
      const ticket = wanted ? await api.observe.ticket(wanted) : null;
      const result = await api.observe.queues.explainRouting(teamId, ticket ? { ticketId: ticket.id } : {});
      const ids = [...new Set([result.userId, ...result.eligible, ...result.rejected.map((entry) => entry.userId)].filter((id): id is string => !!id))];
      const names: Record<string, string> = {};
      if (ids.length > 0) {
        try {
          for (const person of await api.tenant.users({ ids, limit: ids.length })) names[person.id] = person.displayName || person.email;
        } catch {
          // Names are a courtesy; the reasons still read.
        }
      }
      setExplained({ result, names, ticket: ticket ? ticket.number : null });
    } catch (error) {
      setExplained(null);
      setProblem(problemFrom(error));
    } finally {
      setBusy(false);
    }
  };

  const name = (id: string): string => explained?.names[id] ?? 'Unknown person';

  return (
    <Card title="Who would take the next ticket?" subtitle={`A rehearsal for ${teamName}: nothing is assigned.`}>
      <form
        className="app-Routing__explain"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void explain();
        }}
      >
        <FormField label="Ticket number" optional hint="To ask about a particular ticket and the skills it needs, like INC-000123.">
          <Input value={number} autoComplete="off" onChange={(event) => setNumber(event.currentTarget.value)} />
        </FormField>
        <Button type="submit" variant="secondary" loading={busy}>
          Explain
        </Button>
      </form>
      {problem ? (
        <InlineAlert tone="danger">
          {problem.status === 404 ? `There’s no ticket ${number.trim()} that you can see.` : 'Couldn’t ask the router just now. Try again.'}
        </InlineAlert>
      ) : null}
      {explained ? (
        <div className="app-Routing__answer" role="status">
          <p className="app-Routing__verdict">{explanationSentence(explained.result, name, explained.ticket)}</p>
          {explained.result.eligible.length > 1 ? (
            <div>
              <h3 className="app-RotaCard__subhead">Then, in order</h3>
              <ol className="app-Routing__list">
                {explained.result.eligible.slice(1).map((id) => (
                  <li key={id}>{name(id)}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {explained.result.rejected.length > 0 ? (
            <div>
              <h3 className="app-RotaCard__subhead">Passed over</h3>
              <ul className="app-Routing__list">
                {explained.result.rejected.map((entry) => (
                  <li key={entry.userId}>{rejectionSentence(name(entry.userId), entry.because)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
