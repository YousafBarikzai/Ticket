'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, type WorkflowValidation } from '@itsm/sdk';
import { Button, FormField, Input, Select } from '@itsm/ui';
import { api } from '../client/api.js';

/**
 * Everything around a workflow except drawing one.
 *
 * Four things an administrator needs and had no way to do: check a draft
 * before it goes live, publish it, go back when a published version turns out
 * wrong, and unstick a run that has stopped.
 *
 * Validation comes before publishing on the screen because that is the order
 * it should happen in. `validate` reports against the newest draft, not
 * against what is live, which is exactly the question somebody has before
 * publishing and a confusing answer at any other time — so the result says
 * which version it looked at.
 *
 * The three run controls are separated from each other rather than being a
 * row of buttons on every run. Retrying a failed step, skipping one and
 * abandoning a run are three different decisions with three different
 * consequences, and two of them need a reason recorded.
 */
export function WorkflowConsole({
  workflows,
  stuckRuns,
}: {
  workflows: readonly { key: string; name: string; status: string }[];
  stuckRuns: readonly { id: string; label: string }[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [checkKey, setCheckKey] = useState('');
  const [validation, setValidation] = useState<WorkflowValidation | null>(null);

  const [publishKey, setPublishKey] = useState('');
  const [rollbackKey, setRollbackKey] = useState('');
  const [rollbackTo, setRollbackTo] = useState('');

  const [runId, setRunId] = useState('');
  const [runAction, setRunAction] = useState('retry');
  const [reason, setReason] = useState('');

  const needsReason = runAction === 'skip' || runAction === 'cancel';

  async function run(what: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(what);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="itsm-FieldEditor" aria-label="Manage workflows">
      <h2>Manage workflows</h2>

      <form
        aria-label="Check a workflow"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`Checked ${checkKey}.`, async () => {
            setValidation(await api.configure.workflows.validate(checkKey));
          });
        }}
      >
        <h3>Check before publishing</h3>
        <p className="itsm-Admin__note">
          Looks at the newest draft, not at what is live — which is the question worth asking before publishing, and a
          confusing answer at any other time.
        </p>
        <FormField label="Workflow">
          {(control) => (
            <Select
              {...control}
              value={checkKey}
              onChange={(event) => {
                setCheckKey(event.target.value);
                setValidation(null);
              }}
              placeholder="Choose a workflow"
              options={workflows.map((workflow) => ({ value: workflow.key, label: workflow.name }))}
            />
          )}
        </FormField>
        <Button type="submit" disabled={busy || checkKey === ''}>
          Check it
        </Button>

        {validation ? (
          <div className="itsm-RuleEditor__result" role="status">
            <p>
              {validation.problems.length === 0
                ? `Version ${validation.version} has nothing wrong with it.`
                : `Version ${validation.version} has ${validation.problems.length} problem${validation.problems.length === 1 ? '' : 's'}.`}
            </p>
            {validation.problems.length > 0 ? (
              <ul>
                {validation.problems.map((problem, index) => (
                  <li key={index}>
                    {problem.nodeKey ? <code>{problem.nodeKey}</code> : null} {problem.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>

      <form
        aria-label="Publish a workflow"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`${publishKey} is published.`, async () => {
            await api.configure.workflows.publish(publishKey);
            setPublishKey('');
          });
        }}
      >
        <h3>Publish</h3>
        <p className="itsm-Admin__note">
          Runs already under way finish on the version they started with. Only new runs use the new one.
        </p>
        <FormField label="Workflow">
          {(control) => (
            <Select
              {...control}
              value={publishKey}
              onChange={(event) => setPublishKey(event.target.value)}
              placeholder="Choose a workflow"
              options={workflows.map((workflow) => ({ value: workflow.key, label: workflow.name }))}
            />
          )}
        </FormField>
        <Button type="submit" disabled={busy || publishKey === ''}>
          Publish the newest draft
        </Button>
      </form>

      <form
        aria-label="Roll a workflow back"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`${rollbackKey} is back on version ${rollbackTo}.`, async () => {
            await api.configure.workflows.rollback(rollbackKey, Number(rollbackTo));
            setRollbackKey('');
            setRollbackTo('');
          });
        }}
      >
        <h3>Go back a version</h3>
        <p className="itsm-Admin__note">
          When a published version turns out wrong. This makes an earlier version current again; it does not undo what
          runs on the bad version already did.
        </p>
        <FormField label="Workflow">
          {(control) => (
            <Select
              {...control}
              value={rollbackKey}
              onChange={(event) => setRollbackKey(event.target.value)}
              placeholder="Choose a workflow"
              options={workflows.map((workflow) => ({ value: workflow.key, label: workflow.name }))}
            />
          )}
        </FormField>
        <FormField label="Back to version" hint="The version number to make current again.">
          {(control) => (
            <Input {...control} type="number" min="1" value={rollbackTo} onChange={(event) => setRollbackTo(event.target.value)} />
          )}
        </FormField>
        <Button type="submit" disabled={busy || rollbackKey === '' || rollbackTo === ''}>
          Roll back
        </Button>
      </form>

      <form
        aria-label="Unstick a run"
        onSubmit={(event) => {
          event.preventDefault();
          void run('The run has been updated.', async () => {
            if (runAction === 'retry') await api.configure.workflows.retry(runId);
            else if (runAction === 'skip') await api.configure.workflows.skip(runId, reason.trim());
            else await api.configure.workflows.cancel(runId, reason.trim());
            setRunId('');
            setReason('');
          });
        }}
      >
        <h3>Unstick a run</h3>
        {stuckRuns.length === 0 ? (
          <p className="itsm-Admin__note">Nothing is waiting or failed.</p>
        ) : (
          <>
            <FormField label="Run">
              {(control) => (
                <Select
                  {...control}
                  value={runId}
                  onChange={(event) => setRunId(event.target.value)}
                  placeholder="Choose a run"
                  options={stuckRuns.map((stuck) => ({ value: stuck.id, label: stuck.label }))}
                />
              )}
            </FormField>
            <FormField label="What to do">
              {(control) => (
                <Select
                  {...control}
                  value={runAction}
                  onChange={(event) => setRunAction(event.target.value)}
                  options={[
                    { value: 'retry', label: 'Retry the step that failed' },
                    { value: 'skip', label: 'Skip the step and carry on' },
                    { value: 'cancel', label: 'Abandon the whole run' },
                  ]}
                />
              )}
            </FormField>
            {needsReason ? (
              <FormField
                label="Reason"
                hint="Recorded against the run. Somebody will read this when they ask why a step did not happen."
              >
                {(control) => <Input {...control} value={reason} onChange={(event) => setReason(event.target.value)} />}
              </FormField>
            ) : null}
            <Button type="submit" disabled={busy || runId === '' || (needsReason && reason.trim() === '')}>
              {runAction === 'retry' ? 'Retry' : runAction === 'skip' ? 'Skip the step' : 'Abandon the run'}
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
        There is no graph editor, so a workflow cannot be created or have its steps changed here — that is a project of
        its own and is reachable through the API meanwhile. The dry run is API-only too: it needs a sample context
        shaped like the workflow expects, which without the editor is a JSON document nobody can compose from this
        screen.
      </p>
    </section>
  );
}
