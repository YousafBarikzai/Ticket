'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button, Card, Form, FormField, Icon, Input, Meter, StatusPill, Surface, type Problem } from '@itsm/ui';
import { Dialog } from '@itsm/ui/overlays';
import type { AiBudget } from '@itsm/sdk';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { budgetFigures, budgetProblem, penceFrom } from '../../triage.js';

/**
 * This month's AI spend against its budget (SPEC §6.1 Overview: "Spend of
 * budget (`Meter`, [Edit budget] dialog with `ai.manage`)").
 *
 * The meter shows the cap and the warning line; with no cap there is no
 * meter, only the spend and a sentence saying nothing is ever refused. When
 * the cap is reached, AI calls — triage decisions included — are refused
 * until the month ends or the cap is raised, and the card says so in words.
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';

function pounds(pence: number | null): string {
  return pence === null ? '' : (pence / 100).toFixed(2);
}

const STATE_LOOK = {
  ok: null,
  warned: { tone: 'warning' as const, label: 'Past the warning line' },
  blocked: { tone: 'danger' as const, label: 'Budget reached' },
};

export function BudgetCard({ budget, problem, canEdit, locale }: { readonly budget: AiBudget | null; readonly problem?: Problem; readonly canEdit: boolean; readonly locale: string }): ReactNode {
  const [editing, setEditing] = useState(false);
  const labelId = useId();
  if (!budget) return <Card title="AI spend this month" {...(problem ? { problem } : {})} />;
  const figures = budgetFigures(budget);
  const look = STATE_LOOK[budget.state];
  return (
    <>
      <Surface as="section" padding="md" elevation="xs" className="app-Budget" aria-labelledby={labelId} data-state={budget.state}>
        <div className="app-Budget__head">
          <Icon name="sparkles" size="sm" className="app-Budget__icon" />
          <p id={labelId} className="app-Budget__label">
            AI spend this month
          </p>
          {canEdit ? (
            <Button size="sm" variant="tinted" onClick={() => setEditing(true)}>
              Edit budget
            </Button>
          ) : null}
        </div>
        <p className="app-Budget__spent">{budget.spentDisplay}</p>
        {look ? (
          <span className="app-Budget__state">
            <StatusPill size="sm" tone={look.tone} label={look.label} />
          </span>
        ) : null}
        {figures.limit !== null ? (
          <Meter
            label="Spent of the monthly cap"
            value={figures.spent}
            max={Math.max(figures.limit, 0.01)}
            hardLine={figures.limit}
            {...(figures.warn !== null ? { softLine: figures.warn } : {})}
            format={{ style: 'currency', currency: 'GBP' }}
            locale={locale}
          />
        ) : null}
        <p className="app-Budget__note">
          {budget.state === 'blocked'
            ? 'AI calls are refused until the month ends or the cap is raised. New tickets keep what intake gives them.'
            : figures.limit === null
              ? 'No monthly cap: spend is counted and never refused.'
              : figures.warn !== null
                ? `Administrators are told at £${pounds(budget.warnPence)}; calls stop at £${pounds(budget.limitPence)}.`
                : `Calls stop at £${pounds(budget.limitPence)}.`}
        </p>
      </Surface>
      {canEdit ? <BudgetDialog open={editing} budget={budget} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

function BudgetDialog({ open, budget, onClose }: { readonly open: boolean; readonly budget: AiBudget; onClose(): void }): ReactNode {
  const formId = useId();
  const online = useOnline();
  const save = useMutation((input: { limitPence: number | null; warnPence: number | null }) => api.observe.ai.setBudget(input), {
    success: 'AI budget saved',
    failure: 'Couldn’t save the AI budget',
  });
  const close = (): void => {
    save.reset();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Edit AI budget"
      description="Counted per calendar month across every AI feature. Leave a field empty for no line."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={save.pending} loadingLabel="Saving…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Save budget
          </Button>
        </>
      }
    >
      {open ? (
        <Form
          id={formId}
          aria-label="Edit AI budget"
          onSubmit={async (data) => {
            const limit = penceFrom(String(data.get('limit') ?? ''));
            const warn = penceFrom(String(data.get('warn') ?? ''));
            const errors: Record<string, string> = {};
            if (limit === 'invalid') errors.limit = 'Enter an amount in pounds, such as 250 or 250.00.';
            if (warn === 'invalid') errors.warn = 'Enter an amount in pounds, such as 200 or 200.00.';
            if (Object.keys(errors).length > 0) return { fieldErrors: errors };
            const problem = budgetProblem(limit as number | null, warn as number | null);
            if (problem) return { fieldErrors: { [problem.field]: problem.message } };
            const result = await save.run({ limitPence: limit as number | null, warnPence: warn as number | null });
            if (!result.ok) return result.problem.fieldErrors ? { fieldErrors: result.problem.fieldErrors } : { message: result.problem.detail ?? 'The budget wasn’t saved.' };
            close();
            return undefined;
          }}
        >
          <FormField label="Monthly cap" optional hint="AI calls stop when the month’s spend reaches it.">
            <Input name="limit" inputMode="decimal" prefix="£" defaultValue={pounds(budget.limitPence)} autoComplete="off" />
          </FormField>
          <FormField label="Warn at" optional hint="Administrators are told when spend passes it.">
            <Input name="warn" inputMode="decimal" prefix="£" defaultValue={pounds(budget.warnPence)} autoComplete="off" />
          </FormField>
        </Form>
      ) : null}
    </Dialog>
  );
}
