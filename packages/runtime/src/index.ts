/**
 * @itsm/runtime — assembles the platform from its modules.
 *
 * Importing a module registers its manifest, its event handlers and its jobs
 * as a side effect, which is how the API and the worker end up running the
 * same code from different entry points (ADR-0001). Both apps import this
 * package and nothing else module-shaped, so there is exactly one list of what
 * the platform contains.
 */
import {
  environmentResolver,
  logger,
  modules,
  registerModule,
  registerSecretResolver,
  validateRegistry,
  type ModuleManifest,
  type TenantContext,
} from '@itsm/platform';

import { identityManifest, seedSystemRoles } from '@itsm/module-identity';
import { tenancyManifest, registerSeedStep } from '@itsm/module-tenancy';
import { ticketManifest } from '@itsm/module-ticket';
import { securityManifest, seedClassifications, registerDefaultClassifications } from '@itsm/module-security';
import { integrationsManifest, registerCredentialStore } from '@itsm/module-integrations';
import { notificationsManifest, seedNotificationDefaults } from '@itsm/module-notifications';
import { searchManifest } from '@itsm/module-search';
import { slaManifest, seedDefaultSlaPolicy } from '@itsm/module-sla';
import { adminManifest, syncInstalledModules } from '@itsm/module-admin';
import { rulesManifest, seedDefaultRules } from '@itsm/module-rules';
import { approvalsManifest, seedApprovalDefaults } from '@itsm/module-approvals';
import { catalogueManifest, seedCatalogueDefaults } from '@itsm/module-catalogue';
import { knowledgeManifest, seedKnowledgeDefaults } from '@itsm/module-knowledge';
import { workflowManifest, seedWorkflowDefaults } from '@itsm/module-workflow';
import { workloadManifest } from '@itsm/module-workload';
import { incidentManifest } from '@itsm/module-incident';
import { problemManifest } from '@itsm/module-problem';
import { changeManifest } from '@itsm/module-change';
import { assetsManifest } from '@itsm/module-assets';
import { analyticsManifest, seedAnalyticsDefaults } from '@itsm/module-analytics';
import { feedbackManifest, seedFeedbackDefaults } from '@itsm/module-feedback';
import {
  channelsManifest,
  seedChannelDefaults,
  registerEmailTransport,
  developmentTransport,
} from '@itsm/module-channels';

/** Every module in this deployment, in dependency order. */
export const ALL_MODULES: ModuleManifest[] = [
  tenancyManifest,
  identityManifest,
  securityManifest,
  integrationsManifest,
  ticketManifest,
  slaManifest,
  notificationsManifest,
  searchManifest,
  rulesManifest,
  approvalsManifest,
  channelsManifest,
  catalogueManifest,
  knowledgeManifest,
  workflowManifest,
  workloadManifest,
  incidentManifest,
  problemManifest,
  changeManifest,
  assetsManifest,
  feedbackManifest,
  analyticsManifest,
  adminManifest,
];

let bootstrapped = false;

export interface BootstrapResult {
  modules: string[];
  problems: string[];
}

/**
 * Registers seed steps and in-process configuration. Called once per process,
 * before the API starts serving or the worker starts consuming.
 */
export function bootstrapModules(): BootstrapResult {
  if (bootstrapped) return { modules: modules().map((m) => m.id), problems: [] };
  bootstrapped = true;

  // Masking rules are in-process state, so they are registered at boot rather
  // than read from the database on every serialisation.
  registerDefaultClassifications();

  // Credential resolution, in order. The encrypted per-tenant store first, so a
  // tenant's own credential wins over a deployment-wide one of the same name;
  // the environment last, which is what a single-tenant deployment relies on
  // and what the pre-tenant inbound path uses.
  registerCredentialStore(registerSecretResolver);
  registerSecretResolver('environment', environmentResolver);

  // The development email transport verifies nothing, so it is registered only
  // outside production. In production its presence would turn "no provider is
  // configured yet" (OD-03) from a loud error into silent mail loss.
  if (process.env.NODE_ENV !== 'production') {
    registerEmailTransport(developmentTransport());
  }

  // Tenant provisioning runs these in order; each is idempotent so a failed
  // provision can be resumed rather than restarted (docs/architecture/10 §4).
  registerSeedStep('identity.roles', async (ctx: TenantContext) => {
    await seedSystemRoles(ctx);
  });
  registerSeedStep('security.classifications', async (ctx: TenantContext) => {
    await seedClassifications(ctx);
  });
  registerSeedStep('sla.defaultPolicy', async (ctx: TenantContext) => {
    await seedDefaultSlaPolicy(ctx);
  });
  registerSeedStep('notifications.defaults', async (ctx: TenantContext) => {
    await seedNotificationDefaults(ctx);
  });
  registerSeedStep('rules.defaults', async (ctx: TenantContext) => {
    await seedDefaultRules(ctx);
  });
  registerSeedStep('approvals.defaults', async (ctx: TenantContext) => {
    await seedApprovalDefaults(ctx);
  });
  registerSeedStep('channels.defaults', async (ctx: TenantContext) => {
    await seedChannelDefaults(ctx);
  });
  registerSeedStep('catalogue.defaults', async (ctx: TenantContext) => {
    await seedCatalogueDefaults(ctx);
  });
  registerSeedStep('knowledge.defaults', async (ctx: TenantContext) => {
    await seedKnowledgeDefaults(ctx);
  });
  registerSeedStep('workflow.defaults', async (ctx: TenantContext) => {
    await seedWorkflowDefaults(ctx);
  });
  registerSeedStep('analytics.defaults', async (ctx: TenantContext) => {
    await seedAnalyticsDefaults(ctx);
  });
  registerSeedStep('feedback.defaults', async (ctx: TenantContext) => {
    await seedFeedbackDefaults(ctx);
  });
  registerSeedStep('admin.modules', async (ctx: TenantContext) => {
    await syncInstalledModules(ctx);
  });

  const problems = validateRegistry();
  if (problems.length > 0) {
    // A registry that does not hold together is a deployment error, not a
    // runtime one: fail loudly at boot rather than at the first event.
    logger.error('module registry is inconsistent', { problems });
  }

  logger.info('modules registered', { count: modules().length, ids: modules().map((m) => m.id) });
  return { modules: modules().map((m) => m.id), problems };
}

export { modules, registerModule };
