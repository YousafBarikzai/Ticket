import 'dotenv/config';
import {
  SYSTEM_PERMISSIONS,
  createContext,
  disconnectDb,
  disconnectRedis,
  logger,
  platformDb,
  withContext,
  type TenantContext,
} from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { tenantService } from '@itsm/module-tenancy';
import { userService } from '@itsm/module-identity';
import { ticketService } from '@itsm/module-ticket';

/**
 * The seed (docs/architecture/06 §14).
 *
 * Creates TWO tenants with deliberately identical data — same ticket numbers,
 * same titles, same email local parts — because the isolation suite's job is to
 * prove that identical-looking records never cross the boundary. If the two
 * tenants differed, a leak could pass unnoticed.
 */

interface SeedPerson {
  key: string;
  name: string;
  local: string;
  role: string;
  team?: string;
}

const PEOPLE: SeedPerson[] = [
  { key: 'admin', name: 'Alex Administrator', local: 'alex.admin', role: 'administrator' },
  { key: 'lead', name: 'Priya Lead', local: 'priya.lead', role: 'team_lead', team: 'service-desk-l1' },
  { key: 'agent1', name: 'Sam Agent', local: 'sam.agent', role: 'agent', team: 'service-desk-l1' },
  { key: 'agent2', name: 'Jo Resolver', local: 'jo.resolver', role: 'agent', team: 'network-team' },
  { key: 'requester1', name: 'Ada Requester', local: 'ada.requester', role: 'requester' },
  { key: 'requester2', name: 'Grace Requester', local: 'grace.requester', role: 'requester' },
  { key: 'owner', name: 'Owen Owner', local: 'owen.owner', role: 'service_owner' },
];

const TICKETS = [
  { title: 'VPN will not connect from home', type: 'incident' as const, priority: 'P2' as const, requester: 'requester1', group: 'network-team' },
  { title: 'Laptop screen flickers', type: 'incident' as const, priority: 'P3' as const, requester: 'requester2', group: 'service-desk-l1' },
  { title: 'Request a second monitor', type: 'request' as const, priority: 'P4' as const, requester: 'requester1', group: 'service-desk-l1' },
  { title: 'Cannot access the finance share', type: 'incident' as const, priority: 'P2' as const, requester: 'requester2', group: 'service-desk-l1' },
  { title: 'Email delivery to suppliers is delayed', type: 'incident' as const, priority: 'P1' as const, requester: 'requester1', group: 'network-team' },
];

export interface SeededTenant {
  tenantId: string;
  slug: string;
  organisationIds: string[];
  userIds: Record<string, string>;
  teamIds: Record<string, string>;
  ticketNumbers: string[];
}

async function seedTenant(name: string, slug: string, domain: string): Promise<SeededTenant> {
  const existing = await tenantService.findTenantBySlug(slug);
  if (existing) {
    logger.info('tenant already seeded; removing it so the seed is repeatable', { slug });
    await platformDb().tenant.delete({ where: { id: existing.id } });
  }

  const { tenantId } = await tenantService.provisionTenant({ name, slug, region: 'eu-west' });
  const ctx: TenantContext = createContext({
    tenantId,
    actor: { type: 'system', id: null, displayName: 'seed' },
    permissions: SYSTEM_PERMISSIONS,
  });

  return withContext(ctx, async () => {
    const root = await tenantService.createOrganisation(ctx, { name, code: slug.toUpperCase(), type: 'group' });
    const uk = await tenantService.createOrganisation(ctx, { name: `${name} UK`, code: `${slug.toUpperCase()}-UK`, parentId: root.id });

    // The seeding context must carry the organisations, because scoped
    // permissions and settings resolution both read them.
    const orgCtx: TenantContext = { ...ctx, organisationIds: [root.id, uk.id], organisationPaths: [root.path, uk.path] };

    const teamIds: Record<string, string> = {};
    for (const team of [
      { key: 'service-desk-l1', name: 'Service Desk L1' },
      { key: 'network-team', name: 'Network Team' },
    ]) {
      const created = await userService.createTeam(orgCtx, { key: team.key, name: team.name, orgId: uk.id });
      teamIds[team.key] = created.id;
    }

    const userIds: Record<string, string> = {};
    for (const person of PEOPLE) {
      const user = await userService.createUser(
        orgCtx,
        { email: `${person.local}@${domain}`, displayName: person.name, primaryOrgId: uk.id },
        'seed',
      );
      userIds[person.key] = user.id;
      await userService.assignRole(orgCtx, { userId: user.id, roleKey: person.role });
      if (person.team) await userService.addTeamMember(orgCtx, teamIds[person.team]!, user.id, person.role === 'team_lead');
    }

    const ticketNumbers: string[] = [];
    for (const seedTicket of TICKETS) {
      // Raised as the requester, so the audit trail and "own" scope are honest.
      const requesterCtx: TenantContext = {
        ...orgCtx,
        actor: { type: 'user', id: userIds[seedTicket.requester]!, displayName: seedTicket.requester },
      };
      const ticket = await withContext(requesterCtx, () =>
        ticketService.createTicket(requesterCtx, {
          type: seedTicket.type,
          title: seedTicket.title,
          description: `${seedTicket.title}. Raised by the seed script for demonstration and testing.`,
          descriptionFormat: 'text',
          priority: seedTicket.priority,
          requesterId: userIds[seedTicket.requester]!,
          groupId: teamIds[seedTicket.group]!,
          orgId: uk.id,
          sourceChannel: 'portal',
          custom: {},
        }),
      );
      ticketNumbers.push(ticket.number);
    }

    logger.info('tenant seeded', { slug, users: Object.keys(userIds).length, tickets: ticketNumbers.length });
    return { tenantId, slug, organisationIds: [root.id, uk.id], userIds, teamIds, ticketNumbers };
  });
}

export async function seed(): Promise<{ acme: SeededTenant; beta: SeededTenant }> {
  bootstrapModules();
  // Identical shapes on purpose: see the note at the top of this file.
  const acme = await seedTenant('Acme Group', 'acme', 'acme.test');
  const beta = await seedTenant('Beta Industries', 'beta', 'beta.test');
  return { acme, beta };
}

const isEntryPoint = process.argv[1]?.endsWith('seed.ts');
if (isEntryPoint) {
  try {
    const result = await seed();
    console.log('\nSeeded two tenants with identical-looking data:\n');
    for (const tenant of [result.acme, result.beta]) {
      console.log(`  ${tenant.slug.padEnd(6)} ${tenant.tenantId}  tickets: ${tenant.ticketNumbers.join(', ')}`);
    }
    console.log('\nSign in as any seeded person with `pnpm platform token <slug> <email>`.\n');
  } catch (error) {
    logger.error('seed failed', { error: (error as Error).message, stack: (error as Error).stack });
    process.exitCode = 1;
  } finally {
    await disconnectDb();
    await disconnectRedis();
  }
}
