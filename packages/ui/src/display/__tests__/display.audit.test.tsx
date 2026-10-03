// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, it } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Avatar } from '../../web/Avatar.js';
import { Badge } from '../../web/Badge.js';
import { Card } from '../../web/Card.js';
import { RichText } from '../../web/RichText.js';
import { Table } from '../../web/Table.js';
import { Tile, TileGrid } from '../../web/Tile.js';
import { Timeline, type TimelineEvent } from '../../web/Timeline.js';
import { ActivityFeed, type ActivityItem } from '../ActivityFeed.js';
import { AttentionList } from '../AttentionList.js';
import { AvatarStack } from '../AvatarStack.js';
import { DescriptionList } from '../DescriptionList.js';
import { Disclosure } from '../Disclosure.js';
import { FileChip } from '../FileChip.js';
import { KanbanCard, KanbanColumn } from '../Kanban.js';
import { PriorityChip } from '../PriorityChip.js';
import { Prose } from '../Prose.js';
import { StatusPill } from '../StatusPill.js';
import { Stepper } from '../Stepper.js';
import { Surface } from '../Surface.js';
import { MAJOR_INCIDENT_LOOK, TICKET_STATE_LOOK } from '../ticket-states.js';

/*
 * Every display export, read by axe (SPEC §8.0 rule 5), in the shapes the
 * applications render: cards in each state, tiles, badges and pills in every
 * tone (on a navy hero too), priority chips, an attention list with tabs and
 * quick actions, a board column with a folded neighbour, avatars of every
 * kind, a stack with its list open, the three
 * description-list layouts, disclosures, an article, steppers, file chips
 * with remove buttons, a property table, a feed with new items waiting, and
 * both timeline variants with a run expanded and the "new" marker placed.
 */

const noop = (): void => undefined;

// Real timers: axe schedules its own work, and the structure audited here
// does not depend on the time of day.
afterEach(() => cleanupDocument());

function audit(element: ReactElement) {
  const rendered = render(<TestProvider timeZone="Europe/London">{element}</TestProvider>);
  return { ...rendered, check: () => expectNoViolations(document.body) };
}

const events: readonly TimelineEvent[] = [
  { id: 'd', kind: 'description', timestamp: '2026-09-28T08:14:00Z', title: 'Original request', body: 'The VPN drops.', actor: 'Ada Lovelace', author: 'requester', channel: 'email' },
  { id: 's1', kind: 'event', timestamp: '2026-09-29T09:00:00Z', title: 'changed the status', actor: 'Jo Lead', from: 'New', to: 'In progress' },
  { id: 's2', kind: 'event', timestamp: '2026-09-29T09:03:00Z', title: 'set the priority to P2', actor: 'Jo Lead' },
  { id: 'n', timestamp: '2026-09-29T10:02:00Z', title: 'Internal note', body: 'MTU again.', actor: 'Sam Agent', author: 'agent', visibility: 'internal' },
  { id: 'r', timestamp: '2026-09-29T11:30:00Z', title: 'Reply', body: 'Still dropping.', actor: 'Ada Lovelace', author: 'requester', attachments: [{ name: 'trace.log', size: 2048, href: '/files/1' }, { name: 'shot.png', state: 'unavailable' }] },
];

const activity: readonly ActivityItem[] = [
  { id: 'a', at: '2026-09-29T11:57:00Z', actor: { name: 'Jo Lead' }, verb: 'published', object: { label: 'VIP requester', href: '/rules/vip' }, from: 'Draft', to: 'Live', channel: 'api' },
  { id: 'b', at: '2026-09-28T16:00:00Z', actor: { name: 'Assist', kind: 'ai' }, verb: 'suggested a category for', object: { label: 'INC-000124' }, tone: 'info' },
  { id: 'c', at: '2026-09-28T15:00:00Z', verb: 'Delivery failed', detail: '503 from the endpoint', tone: 'danger', icon: 'webhook' },
];

describe('display audit', () => {
  it('Surface and Card: plain, navigable with actions, loading, failed and empty', async () => {
    await audit(
      <div>
        <Surface as="section" aria-label="Summary">
          Summary
        </Surface>
        <Card title="Rules" subtitle="12 live" icon="automation" meta={<StatusPill label="Live" tone="success" size="sm" />} footer="Updated 2 min ago">
          <p>Automate routing.</p>
        </Card>
        <Card title="Workflows" href="/workflows" actions={<button type="button">More options for Workflows</button>}>
          <p>
            Three running. <a href="/workflows/runs">See runs</a>
          </p>
        </Card>
        <Card title="On call" loading />
        <Card loading />
        <Card title="Failed deliveries" problem={{ status: 503, retryable: true }} onRetry={noop} />
        <Card title="Forms" titleAs="h3" empty={{ title: 'No forms yet', action: { id: 'new', label: 'New form' } }} onAction={noop} headerDivider />
        <Card title="Region" asRegion>
          x
        </Card>
      </div>,
    ).check();
  });

  it('Tile and TileGrid: links with icons and badges, and a button', async () => {
    await audit(
      <TileGrid columns={3}>
        <Tile title="Something is broken" description="Report an issue." href="/report" icon="compose" />
        <Tile title="I need something" description="Software, access, hardware." href="/catalogue" icon="catalogue" badge={<Badge tone="accent">New</Badge>} meta="Usually 2 days" />
        <Tile title="Dictate a request" onClick={noop} icon={<span>+</span>} />
      </TileGrid>,
    ).check();
  });

  it('Badge and StatusPill: every tone and emphasis, and the pill as a trigger', async () => {
    const tones = ['neutral', 'accent', 'info', 'success', 'warning', 'danger', 'hold', 'high'] as const;
    await audit(
      <div>
        {tones.map((tone) => (
          <p key={tone}>
            <Badge tone={tone} srPrefix="Priority" dot>
              P2
            </Badge>
            <Badge tone={tone} emphasis="solid" icon="flag" size="sm">
              P1
            </Badge>
            <Badge tone={tone} emphasis="outline">
              3
            </Badge>
            <StatusPill label="Waiting for you" tone={tone} srPrefix="Status" />
            <StatusPill label="Paused" tone={tone} icon="pause" emphasis="solid" size="sm" />
          </p>
        ))}
        <StatusPill label="View only" tone="neutral" icon="lock" as="button" aria-haspopup="dialog" aria-expanded={false} />
        <StatusPill label="Critical" tone="danger" meta="16" size="sm" />
        <div data-surface="hero">
          <StatusPill {...TICKET_STATE_LOOK.pending_requester} />
          <StatusPill {...MAJOR_INCIDENT_LOOK} />
        </div>
      </div>,
    ).check();
  });

  it('PriorityChip, AttentionList and Kanban: every priority, a list with tabs and actions, a board with a folded column', async () => {
    await audit(
      <div>
        <p>
          {(['P1', 'P2', 'P3', 'P4'] as const).map((priority) => (
            <PriorityChip key={priority} priority={priority} words />
          ))}
        </p>
        <section aria-labelledby="audit-needs-you">
          <h2 id="audit-needs-you">Needs you</h2>
          <AttentionList
            label="Needs you"
            tabs={[
              { id: 'all', label: 'All', count: 2, href: '/overview', current: true },
              { id: 'breached', label: 'Breached', count: 1, href: '/overview?attention=breached' },
            ]}
            items={[
              { id: 'a', severity: 'danger', ref: 'INC-000123', title: 'VPN drops', href: '/tickets/1', reason: { label: 'Breached', tone: 'danger' }, owner: { name: 'Alex Morgan' }, due: { label: 'Yesterday', overdue: true, slip: '+1d' } },
              { id: 'b', severity: 'warning', ref: 'REQ-000456', title: 'SharePoint access', href: '/tickets/2', reason: { label: 'Breaches in 43 min' }, owner: null, due: { label: '16:00' } },
            ]}
            rowActions={[{ id: 'assign', label: 'Assign to me' }]}
            onAction={noop}
          />
        </section>
        <h2>Board</h2>
        <KanbanColumn id="audit-progress" title="In progress" tone="info" icon="clock" count={1} onFoldedChange={noop}>
          <KanbanCard href="/tickets/1" refId="INC-000123" title="VPN drops" priority="P1" assignee={null} due={{ label: 'Yesterday', overdue: true }} stripe="danger" progress={0.9} unread />
        </KanbanColumn>
        <KanbanColumn id="audit-closed" title="Closed" tone="neutral" icon="archive" count={41} folded onFoldedChange={noop} />
      </div>,
    ).check();
  });

  it('Avatar and AvatarStack: every kind, presence, and the overflow list open', async () => {
    const { container, check } = audit(
      <div>
        <Avatar name="Ada Lovelace" status="online" size="xl" />
        <Avatar name="Grace Hopper" status="away" size="lg" />
        <Avatar name="Service Desk" kind="team" status="busy" />
        <Avatar name="Assist" kind="ai" size="sm" />
        <Avatar name="Automation" kind="system" status="offline" size="xs" />
        <Avatar kind="unassigned" size="sm" />
        <Avatar name="Emma Clarke" size={44} ring />
        <p>
          <Avatar name="Alan Turing" decorative size="sm" /> Alan Turing
        </p>
        <AvatarStack people={[{ name: 'Ada' }, { name: 'Grace' }]} label="Watchers" />
        <AvatarStack people={['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara'].map((name) => ({ name }))} label="Assignees" />
      </div>,
    );
    await check();
    click(container.querySelector('summary')!);
    await check();
  });

  it('DescriptionList: every layout, with empty values and hints', async () => {
    const items = [
      { id: 'p', label: 'Priority', value: <StatusPill label="P2" tone="warning" size="sm" />, hint: 'Set by rule' },
      { id: 't', label: 'Team', value: null },
      { id: 'o', label: 'Owner', value: 'Sam Agent' },
    ];
    await audit(
      <div>
        <DescriptionList items={items} />
        <DescriptionList items={items} layout="inline" dense />
        <DescriptionList items={items} layout="grid" />
      </div>,
    ).check();
  });

  it('Disclosure, Prose and RichText', async () => {
    await audit(
      <div>
        <Disclosure summary="Details">
          <p>Reference INC-000123</p>
        </Disclosure>
        <Disclosure summary="Open by default" defaultOpen persistKey="audit.disclosure">
          <p>Shown</p>
        </Disclosure>
        <Prose size="lg">
          <h2>Resetting your VPN</h2>
          <RichText
            content={[
              { type: 'paragraph', content: [{ text: 'Open ' }, { text: 'Settings', bold: true }, { text: ' and read ' }, { text: 'the guide', href: '/knowledge/vpn' }] },
              { type: 'list', ordered: false, items: [[{ text: 'Quit the app' }], [{ text: 'Sign in again', code: true }]] },
            ]}
          />
        </Prose>
      </div>,
    ).check();
  });

  it('Stepper: horizontal and vertical, every status', async () => {
    const steps = [
      { id: 'r', label: 'Received', status: 'complete' as const, description: '28 Sept' },
      { id: 'w', label: 'Being worked on', status: 'current' as const },
      { id: 'y', label: 'Waiting for you', status: 'waiting' as const },
      { id: 'a', label: 'Approval', status: 'error' as const },
      { id: 's', label: 'Survey', status: 'skipped' as const },
      { id: 'c', label: 'Closed', status: 'upcoming' as const },
    ];
    await audit(
      <div>
        <Stepper label="Request progress" steps={steps} />
        <Stepper label="Setup" steps={steps} orientation="vertical" size="sm" />
      </div>,
    ).check();
  });

  it('FileChip: every state, with and without remove', async () => {
    await audit(
      <ul>
        <li>
          <FileChip name="annual-report.pdf" size={1_536_000} href="/files/1" onRemove={noop} />
        </li>
        <li>
          <FileChip name="scan.png" state="scanning" onRemove={noop} />
        </li>
        <li>
          <FileChip name="virus.exe" state="blocked" />
        </li>
        <li>
          <FileChip name="shot.png" size={2048} state="unavailable" />
        </li>
      </ul>,
    ).check();
  });

  it('Table: sorted, selected, loading and empty', async () => {
    type Row = { readonly id: string; readonly name: string; readonly count: number };
    const rows: Row[] = [
      { id: '1', name: 'VIP requester', count: 12 },
      { id: '2', name: 'After hours', count: 3 },
    ];
    const columns = [
      { key: 'name', header: 'Rule', cell: (row: Row) => row.name, sortable: true },
      { key: 'count', header: 'Matched', cell: (row: Row) => <Badge srPrefix="Matched">{row.count}</Badge>, align: 'end' as const },
    ];
    await audit(
      <div>
        <Table caption="Rules" columns={columns} rows={rows} rowKey={(row) => row.id} sort={{ columnKey: 'name', direction: 'ascending' }} />
        <Table caption="Loading rules" captionHidden columns={columns} rows={[]} rowKey={(row) => row.id} loading skeletonRows={2} />
        <Table caption="No rules" columns={columns} rows={[]} rowKey={(row) => row.id} empty="No rules yet" />
      </div>,
    ).check();
  });

  it('ActivityFeed: grouped with new items waiting, flat with a view-all link, and empty', async () => {
    await audit(
      <div>
        <ActivityFeed label="Recent activity" items={activity} newCount={3} onShowNew={noop} />
        <ActivityFeed label="Channel log" items={activity} groupBy="none" max={2} viewAllHref="/audit" headingLevel={2} />
        <ActivityFeed label="Quiet feed" items={[]} empty={{ title: 'Nothing yet', description: 'Activity shows here.' }} />
      </div>,
    ).check();
  });

  it('Timeline: the thread with a run open and the new marker, the conversation by day, and the empty one', async () => {
    const { container, check } = audit(
      <div>
        <Timeline label="Ticket history" events={events} collapseSystem={{ withinMinutes: 10 }} newSinceId="n" />
        <Timeline label="Conversation" events={events} variant="conversation" groupBy="day" collapseSystem={{ withinMinutes: 10 }} />
        <Timeline label="Portal conversation" events={events} variant="conversation" perspective="requester" filter="messages" />
        <Timeline label="Empty history" events={[]} />
      </div>,
    );
    await check();
    for (const toggle of container.querySelectorAll<HTMLButtonElement>('.itsm-Timeline__runToggle')) click(toggle);
    await check();
  });
});
