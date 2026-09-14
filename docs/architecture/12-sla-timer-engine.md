# 12 · SLA timer engine

## 1. Components

| Component | Package | Responsibility |
|---|---|---|
| `business-time` | `packages/business-time` | Pure functions: add business duration to an instant under a calendar (hours, exceptions, time zone, DST), elapsed business time between instants, remaining time; 100 % branch coverage; no I/O. |
| Policy matcher | `modules/sla/service` | Selects the most specific `sla_policy` for a ticket using the expression language over ticket, service, organisation, location, priority, requester tier and channel; records the explanation. |
| Timer service | `modules/sla/service` | Starts, pauses, resumes, recomputes, meets, breaches and cancels `sla_timer` rows in response to ticket events. |
| Scheduler | `modules/sla/jobs` | Minute tick per partition; finds due warnings and breaches; emits events and enqueues actions. |
| Escalation | `modules/sla/service` | Applies `escalation_rule` steps: notifications (MOD-11), reassignment (MOD-20), workflow start (MOD-06). |

## 2. Timer model

```
sla_timer (
  id, tenant_id, ticket_id, task_id null, target_type (response|update|restoration|resolution|fulfilment|approval),
  policy_version_id, calendar_id, started_at, due_at, paused_at null, elapsed_ms, remaining_ms,
  state (running|paused|met|breached|cancelled), warning_thresholds int[], warnings_fired int[],
  partition smallint,        -- hash(ticket_id) % 16
  version int
)
index (tenant_id, ticket_id); partial index (partition, due_at) where state = 'running'
```

- `due_at` is materialised whenever the timer runs, computed by `business-time` from `started_at`/`resume` instant, `remaining_ms` and the calendar, so the scheduler can use a plain range scan.
- **Pause** stores `paused_at` and freezes `remaining_ms` (elapsed business time is recomputed at pause); **resume** recomputes `due_at` from the resume instant. Pause reasons are policy-driven (pending requester, supplier, change) and every pause interval is stored in `sla_pause (timer_id, reason, from, to)` for reporting.
- **Priority change** recomputes the target: new target minutes − elapsed business time = remaining; recorded in the timeline with before/after.
- **Reopen** resumes from remaining time or restarts, per policy.
- **Update timers** (cadence targets such as "every 30 minutes") are re-armed on each qualifying public comment.

## 3. Event-driven transitions

| Event | Timer action |
|---|---|
| `ticket.created` | Match policy → start response and resolution timers (and update timer if defined) in the ticket's calendar |
| `ticket.comment.added` (public, by agent) | Meet response timer if running; re-arm update timer |
| `ticket.status.changed` | Map to canonical category: Open → resume; Paused → pause (if policy allows for that reason); Resolved → stop (met/breached decided); Closed/Cancelled → cancel |
| `ticket.updated` (priority, service, group) | Re-match policy if match inputs changed; recompute targets |
| `ticket.assigned` | Recompute `due_at` if the calendar follows the assigned group |
| `approval.requested/decided` | Start/stop approval timers |
| Manual `pause/resume/excuse` API | With reason; audit |

Handlers take the per-ticket lock (see [07 §2.4](07-eventing-and-integration.md#24-ordering)) so timer transitions for one ticket are serial.

## 4. Scheduler

- BullMQ repeatable job `sla:tick:{p}` for `p ∈ 0…15`, every minute, spread across `worker-engine` replicas; each tick handles its partition: `SELECT … FROM sla_timer WHERE partition = p AND state = 'running' AND (due_at <= now + 60s OR next_warning_at <= now) LIMIT 5000 FOR UPDATE SKIP LOCKED`.
- For each row: fire due warnings (threshold percentages converted to instants at start and stored as `next_warning_at`), or mark `breached` at `due_at`, publish `sla.timer.warning|breached`, enqueue escalation actions. Warnings are idempotent through `warnings_fired`.
- Tick duration and lateness (`now − due_at` at processing) are metrics; SLO lateness < 60 s; alert on partition backlog. Partition count is fixed at 16 and can be raised with a one-time re-hash migration.
- Because RLS is forced, no query can span tenants: each `sla:tick:{p}` job fans out one child job per active tenant, and each child opens a tenant-scoped transaction (actor type `scheduler`) and scans that tenant's running timers in partition `p`. A large tenant therefore cannot delay others, and the per-tenant fan-out is the same pattern every scheduled job uses (03 §3.3).

## 5. Calendars and DST

- `business_calendar (id, tenant_id, org_id, name, time_zone, hours jsonb)` with `calendar_exception (date, type: holiday|extended, hours)`; locations and groups reference a calendar; policies choose `calendar_mode` (service, assigned group, requester location, 24×7).
- `business-time` operates on `Temporal`-style zoned date-times (via `@js-temporal/polyfill` or `date-fns-tz`) and is tested against a matrix of DST transitions (Europe/London, Europe/Istanbul, America/New_York), leap days, multi-day closures and overnight shifts.

## 6. Reporting and simulation

- Timer outcomes project into `analytics.fact_sla_timer` with business and calendar durations; attainment excludes cancelled timers and excused breaches (`breach_record.excused_by`).
- **Simulation** *(PH-4)*: a job replays historical tickets' event streams through a candidate policy version using the same timer service against an in-memory store, reporting attainment by priority, service and team next to the current policy; nothing is written to live tables.

## 7. Forecasting hook *(PH-4)*

`sla.timer.warning` and the timer table are the inputs for breach forecasting (MOD-07-E2): a job scores running timers with features (remaining time, queue depth, agent availability from MOD-20, historical resolution distribution) and raises `sla.timer.at_risk` for pre-breach escalation (a proposed addition to the specification's event catalogue; see 19 §4). The scoring model is served through the AI gateway with the same evaluation and audit controls as other AI features.
