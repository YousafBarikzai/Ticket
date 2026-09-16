import { defineHandler, type TenantContext, type Tx } from '@itsm/platform';
import { impactForSeverity, incidentStatusFor } from '../domain/status.js';
import { openIncident, postUpdate, resolveIncident, setMaintenanceStatus, upsertMaintenance } from '../service/incident-service.js';
import { componentsForServices } from '../service/page-service.js';

/**
 * MOD-23 listens to the desk and repeats the part of it that is public.
 *
 * Each handler reads the source row rather than trusting the payload
 * (ADR-0031): delivery is at least once and unordered, so a handler that
 * copied what the event said would repeat a stale line, and one that
 * assumed the declaration had arrived before the first update would drop
 * that update on the floor. "The event says look again; the row says at
 * what."
 *
 * What is repeated is decided here, once: a major incident appears only if it
 * was declared customer-facing; an update appears only if its audience is
 * `public`; a change appears only if it touches a service the page lists.
 */

type MajorIncidentRow = {
  id: string;
  title: string;
  severity: string;
  customerFacing: boolean;
  affectedServiceIds: string[];
  impactSummary: string | null;
  declaredAt: Date;
};

/**
 * The page's incident for a major incident, opening it if this is the first
 * public thing heard about it. Whichever event arrives first opens it; the
 * others find it open.
 */
async function ensureIncident(ctx: TenantContext, tx: Tx, incident: MajorIncidentRow) {
  const existing = await tx.statusIncident.findFirst({ where: { majorIncidentId: incident.id } });
  if (existing) return existing;
  if (!incident.customerFacing) return null;

  const components = await componentsForServices(tx, incident.affectedServiceIds);
  // The opening line is the declaration's own timeline entry, so the same
  // declaration delivered twice opens nothing twice.
  const opening = await tx.majorIncidentUpdate.findFirst({ where: { incidentId: incident.id, statusTo: 'declared' }, orderBy: { occurredAt: 'asc' } });
  const named = components.map((component) => component.name);
  return openIncident(
    ctx,
    tx,
    {
      title: incident.title,
      impact: impactForSeverity(incident.severity),
      status: 'investigating',
      componentIds: components.map((component) => component.id),
      body: incident.impactSummary ?? (named.length > 0 ? `We are investigating an issue affecting ${named.join(', ')}.` : 'We are investigating an issue and will post an update shortly.'),
      source: 'major_incident',
      majorIncidentId: incident.id,
      sourceRef: opening?.id ?? null,
      startedAt: incident.declaredAt,
    },
    incident.declaredAt,
  );
}

defineHandler({
  consumer: 'statuspage',
  moduleId: 'MOD-23',
  eventType: 'incident.major.declared',
  required: false,
  async handle(ctx, event, tx) {
    const { incidentId } = event.payload as { incidentId: string };
    const incident = await tx.majorIncident.findFirst({ where: { id: incidentId } });
    if (!incident) return;
    await ensureIncident(ctx, tx, incident);
  },
});

defineHandler({
  consumer: 'statuspage',
  moduleId: 'MOD-23',
  eventType: 'incident.major.updated',
  required: false,
  async handle(ctx, event, tx) {
    const { incidentId, updateId } = event.payload as { incidentId: string; updateId: string };
    const update = await tx.majorIncidentUpdate.findFirst({ where: { id: updateId } });
    // The audience is the commander's decision and it is honoured here, not
    // softened: `internal` and `stakeholders` never reach the page.
    if (!update || update.audience !== 'public') return;
    const incident = await tx.majorIncident.findFirst({ where: { id: incidentId } });
    if (!incident) return;

    const mirrored = await ensureIncident(ctx, tx, incident);
    if (!mirrored) return;
    const status = incidentStatusFor(update.statusTo) ?? undefined;
    if (status === 'resolved') {
      await resolveIncident(ctx, tx, mirrored.id, update.body, 'major_incident', update.id);
      return;
    }
    await postUpdate(ctx, tx, mirrored.id, { ...(status ? { status } : {}), body: update.body, source: 'major_incident', sourceRef: update.id }, update.occurredAt);
  },
});

defineHandler({
  consumer: 'statuspage',
  moduleId: 'MOD-23',
  eventType: 'incident.major.resolved',
  required: false,
  async handle(ctx, event, tx) {
    const { incidentId } = event.payload as { incidentId: string };
    const mirrored = await tx.statusIncident.findFirst({ where: { majorIncidentId: incidentId } });
    // Not customer-facing, so never on the page: nothing to resolve. The
    // resolution note itself, if it was public, arrives as an update.
    if (!mirrored) return;
    await resolveIncident(ctx, tx, mirrored.id, 'Service has been restored.', 'major_incident');
  },
});

defineHandler({
  consumer: 'statuspage',
  moduleId: 'MOD-23',
  eventType: 'change.scheduled',
  required: false,
  async handle(ctx, event, tx) {
    const { changeId } = event.payload as { changeId: string };
    const change = await tx.change.findFirst({ where: { id: changeId } });
    if (!change || !change.plannedStartAt || !change.plannedEndAt) return;
    // A change to something the page does not list has no public face. A
    // re-schedule moves the existing notice: `upsertMaintenance` keys on the
    // change.
    const components = await componentsForServices(tx, change.serviceId ? [change.serviceId] : []);
    const existing = await tx.maintenanceWindow.findFirst({ where: { changeId } });
    if (components.length === 0 && !existing) return;
    await upsertMaintenance(ctx, tx, {
      title: change.title,
      body: change.description,
      componentIds: components.map((component) => component.id),
      startsAt: change.plannedStartAt,
      endsAt: change.plannedEndAt,
      source: 'change',
      changeId,
    });
  },
});

defineHandler({
  consumer: 'statuspage',
  moduleId: 'MOD-23',
  eventType: 'change.closed',
  required: false,
  async handle(ctx, event, tx) {
    const { changeId } = event.payload as { changeId: string };
    const window = await tx.maintenanceWindow.findFirst({ where: { changeId } });
    if (!window || window.status === 'completed' || window.status === 'cancelled') return;
    await setMaintenanceStatus(ctx, tx, window.id, 'completed', 'change');
  },
});
