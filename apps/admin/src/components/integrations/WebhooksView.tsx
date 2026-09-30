'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Form, FormField, IconButton, InlineAlert, Input, StatusPill, notify, type ActionSpec, type Plural, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { Combobox, Dialog, Sheet, type ComboboxOption } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { useCreateParam } from '../catalogue/useCreate.js';
import { webhookUrlProblem, type WebhookView } from './presentation.js';
import type { EventChoice, IntegrationsHeader } from './types.js';

/**
 * Integrations › Webhooks (SPEC §6.1 [Plus]): who is told about events on
 * this desk — name, address, events, and whether deliveries are landing.
 * *Add webhook* (`?new=1`) takes a name, an address and the events to send;
 * the signing secret is shown once, when it is made, with Copy, and never
 * again. *Delete…* asks first.
 */
export interface WebhooksViewProps {
  readonly header: IntegrationsHeader;
  readonly rows: readonly WebhookView[];
  readonly events: readonly EventChoice[];
  readonly canManage: boolean;
  readonly problem?: Problem;
}

const NOUN: Plural = { one: 'webhook', other: 'webhooks' };
const OFFLINE = 'You’re offline — changes can’t be saved.';

/** `ticket.created` → "Ticket": the part of the catalogue an event belongs to, for grouping the picker. */
function groupOf(type: string): string {
  const head = type.split('.')[0] ?? type;
  return head.charAt(0).toUpperCase() + head.slice(1).replace(/[_-]/g, ' ');
}

export function WebhooksView({ header, rows, events, canManage, problem }: WebhooksViewProps): ReactNode {
  const create = useCreateParam();
  const router = useRouter();
  const online = useOnline();
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null);

  const remove = useMutation((id: string) => api.tenant.deleteWebhook(id), { failure: 'Couldn’t delete the webhook' });

  const deleteOne = async (row: WebhookView): Promise<void> => {
    const result = await remove.run(row.id);
    if (result.ok) notify(`${row.name} deleted`, { tone: 'success', description: 'It receives no more events.' });
  };

  const deleteSpec = (row: WebhookView) => ({
    title: `Delete ${row.name}?`,
    body: `${row.url} stops receiving events straight away. This can’t be undone; to send events there again, add it again and share the new secret.`,
    confirmLabel: 'Delete webhook',
    tone: 'danger' as const,
  });

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Webhook', field: 'name', kind: 'title', secondaryField: 'url', minWidth: 240, truncate: 2 },
      { id: 'events', header: 'Events', field: 'eventsLabel', minWidth: 220, truncate: 2, hideBelow: 'sm' },
      { id: 'health', header: 'Deliveries', field: 'statusLabel', minWidth: 180, cardRole: 'badge' },
    ],
    [],
  );

  const rowActionsFor = (row: WebhookView): ActionSpec[] =>
    canManage
      ? [{ id: 'delete', label: 'Delete…', icon: 'trash', tone: 'danger', ...(online ? {} : { disabled: true, disabledReason: OFFLINE }), confirm: deleteSpec(row) }]
      : [];

  return (
    <div className="app-Page app-Integrations">
      <PageHeader
        title="Integrations"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'add-webhook', label: 'Add webhook', icon: 'plus', variant: 'primary', shortcut: 'c' } as ActionSpec } : {})}
        onAction={(id) => {
          if (id === 'add-webhook') create.open('1');
        }}
      />
      <h2 className="itsm-visually-hidden">Webhooks</h2>
      <DataTable<WebhookView>
        caption="Webhooks"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="id"
        search={{ placeholder: 'Search webhooks', mode: 'client', shortcut: '/' }}
        {...(canManage ? { rowActionsFor } : {})}
        onAction={async (id, targets) => {
          if (id === 'add-webhook') create.open('1');
          const row = targets[0];
          if (row && id === 'delete') await deleteOne(row);
        }}
        cells={{
          health: (row) => <StatusPill size="sm" tone={row.health.tone} {...(row.health.icon ? { icon: row.health.icon } : {})} label={row.health.label} srPrefix="Deliveries" />,
          events: (row) => <span title={row.events.join(', ')}>{row.eventsLabel}</span>,
        }}
        countNoun={NOUN}
        {...(problem ? { problem, onRetry: () => router.refresh() } : {})}
        empty={{
          title: 'No webhooks yet',
          description: 'A webhook tells another system when something happens here — a ticket raised, a person added.',
          icon: 'webhook',
          ...(canManage ? { action: { id: 'add-webhook', label: 'Add webhook', icon: 'plus', variant: 'primary' } } : {}),
        }}
        noResults={{ title: 'No webhooks match', description: 'Try other words, or clear the search.' }}
      />
      <AddWebhookSheet open={canManage && create.value !== null} events={events} onClose={() => create.close()} onCreated={(name, value) => setSecret({ name, secret: value })} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

function AddWebhookSheet({
  open,
  events,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly events: readonly EventChoice[];
  onClose(): void;
  onCreated(name: string, secret: string): void;
}): ReactNode {
  const formId = useId();
  const online = useOnline();
  const [dirty, setDirty] = useState(false);
  const [chosen, setChosen] = useState<ComboboxOption[]>([]);
  const options = useMemo<ComboboxOption[]>(
    () => events.map((event) => ({ value: event.type, label: event.type, description: event.description, group: groupOf(event.type) })),
    [events],
  );
  const add = useMutation((input: { name: string; url: string; eventTypes: string[] }) => api.tenant.createWebhook(input), {
    success: (row) => `${row.name} added`,
    failure: 'Couldn’t add the webhook',
  });

  const close = (): void => {
    setDirty(false);
    setChosen([]);
    add.reset();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="md"
      title="Add webhook"
      description="Each event is sent as a signed POST. The signing secret is shown once, when the webhook is made."
      dirty={dirty || chosen.length > 0}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={add.pending} loadingLabel="Adding…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Add webhook
          </Button>
        </>
      }
    >
      {open ? (
        <Form
          id={formId}
          aria-label="Add webhook"
          onDirtyChange={setDirty}
          onSubmit={async (data) => {
            const name = String(data.get('name') ?? '').trim();
            const url = String(data.get('url') ?? '').trim();
            const errors: Record<string, string> = {};
            if (name === '') errors.name = 'Give it a name, such as “Reporting warehouse”.';
            const urlProblem = webhookUrlProblem(url);
            if (urlProblem) errors.url = urlProblem;
            if (chosen.length === 0) errors.eventTypes = 'Choose at least one event to send.';
            if (Object.keys(errors).length > 0) return { fieldErrors: errors };
            const result = await add.run({ name, url, eventTypes: chosen.map((option) => option.value) });
            if (!result.ok) return result.problem.fieldErrors ? { fieldErrors: result.problem.fieldErrors } : { message: result.problem.detail ?? 'The webhook wasn’t added.' };
            onCreated(result.value.name, result.value.secret);
            close();
            return undefined;
          }}
        >
          <FormField label="Name" required>
            <Input name="name" maxLength={200} autoComplete="off" />
          </FormField>
          <FormField label="Address" hint="Where events are sent. Use https://." required>
            <Input name="url" type="url" inputMode="url" maxLength={2000} autoComplete="off" spellCheck={false} placeholder="https://" />
          </FormField>
          <FormField label="Events" hint="Only events other systems may receive are listed." required id="eventTypes">
            {(control) => (
              <Combobox
                {...control}
                multiple
                options={options}
                value={chosen}
                onChange={setChosen}
                placeholder="Search events"
                emptyMessage="No event matches"
              />
            )}
          </FormField>
        </Form>
      ) : null}
    </Sheet>
  );
}

function SecretDialog({ secret, onClose }: { readonly secret: { name: string; secret: string } | null; onClose(): void }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={secret !== null}
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      size="sm"
      dismissible={false}
      title="Copy the signing secret now"
      description={secret ? `${secret.name} signs every delivery with this secret. It won’t be shown again.` : undefined}
      footer={
        <Button
          variant="primary"
          onClick={() => {
            setCopied(false);
            onClose();
          }}
        >
          Done
        </Button>
      }
    >
      {secret ? (
        <div className="app-Secret">
          <code className="app-Secret__value">{secret.secret}</code>
          <IconButton
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Copied the signing secret' : 'Copy the signing secret'}
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(secret.secret).then(
                () => setCopied(true),
                () => undefined,
              );
            }}
          />
          <InlineAlert tone="info">Give it to whoever runs the receiving end, so it can check each delivery came from here.</InlineAlert>
        </div>
      ) : null}
    </Dialog>
  );
}
