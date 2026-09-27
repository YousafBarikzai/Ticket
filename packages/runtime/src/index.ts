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
  loadConfig,
  logger,
  modules,
  registerModule,
  registerSecretResolver,
  validateRegistry,
  type ModuleManifest,
  type TenantContext,
} from '@itsm/platform';

import { identityManifest, seedSystemRoles } from '@itsm/module-identity';
import { tenancyManifest, registerSeedStep, seedPlans } from '@itsm/module-tenancy';
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
import { timeManifest, seedTimeDefaults } from '@itsm/module-time';
import { statusPageManifest, seedStatusDefaults } from '@itsm/module-statuspage';
import { migrationManifest } from '@itsm/module-migration';
import { esmManifest } from '@itsm/module-esm';
import {
  activeDefaultModel,
  aiManifest,
  anthropicProvider,
  isPriced,
  parseModelPrices,
  registerAiProvider,
  type AiProvider,
  registerModelPrices,
  seedAiDatasets,
  seedAiPrompts,
  stubProvider,
} from '@itsm/module-ai';
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
  timeManifest,
  statusPageManifest,
  migrationManifest,
  esmManifest,
  aiManifest,
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

  // Plans are the deployment's, not a tenant's, so they are written once at
  // boot rather than by a per-tenant seed step. Idempotent, and it never
  // edits a plan an operator has tuned.
  void seedPlans().catch((error: unknown) => {
    logger.error('the default plans could not be seeded', { error: (error as Error).message });
  });

  // Credential resolution, in order. The encrypted per-tenant store first, so a
  // tenant's own credential wins over a deployment-wide one of the same name;
  // the environment last, which is what a single-tenant deployment relies on
  // and what the pre-tenant inbound path uses.
  registerCredentialStore(registerSecretResolver);
  registerSecretResolver('environment', environmentResolver);

  // Prompts and evaluation datasets are the deployment's, like plans: written
  // once at boot rather than per tenant, and never over an operator's edit.
  void seedAiPrompts()
    .then(() => seedAiDatasets())
    .catch((error: unknown) => {
      logger.error('the AI prompts could not be seeded', { error: (error as Error).message });
    });

  registerAiPricesAndProvider();

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
  registerSeedStep('time.defaults', async (ctx: TenantContext) => {
    await seedTimeDefaults(ctx);
  });
  // After the catalogue, so the default service is a component from the start.
  registerSeedStep('statuspage.defaults', async (ctx: TenantContext) => {
    await seedStatusDefaults(ctx);
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

/**
 * The model provider and its price list, chosen by configuration.
 *
 * Three rules, and each one exists because of a way this goes wrong quietly:
 *
 * **The stub is refused in production.** It answers without a model, so its
 * presence in a deployment turns "no provider has been chosen" from a refusal
 * somebody fixes into answers somebody believes. Same bargain the development
 * email transport strikes, for the same reason.
 *
 * **Prices are loaded before the provider.** An unpriced model is refused at
 * the point of call (`ModelNotPriced`), so loading the provider first would
 * open a window in which calls are made and costed at nothing.
 *
 * **A malformed price list stops the boot.** A half-loaded price list produces
 * a budget that half-works, which is the worst of the three outcomes — worse
 * than no AI, and much worse than a process that will not start.
 *
 * **So does a default model the provider does not offer.** `AI_DEFAULT_MODEL`
 * naming a model outside the provider's list is an operator's typo, and it is
 * refused here like a missing key rather than in a worker, one suggestion at a
 * time, long after the deploy that caused it.
 *
 * **A default with no price is logged, not fatal.** Every call against it is
 * already refused with a message naming `AI_MODEL_PRICES` (ADR-0042), and
 * stopping the whole platform — tickets and all — over an AI price would be a
 * bigger outage than the one it reports.
 */
function registerAiPricesAndProvider(): void {
  const config = loadConfig();

  if (config.AI_MODEL_PRICES) {
    registerModelPrices(parseModelPrices(config.AI_MODEL_PRICES));
  }

  const provider = chooseAiProvider(config);
  if (!provider) return;

  registerAiProvider(provider, config.AI_DEFAULT_MODEL ? { defaultModel: config.AI_DEFAULT_MODEL } : {});
  const model = activeDefaultModel();
  if (model && !isPriced(model)) {
    logger.error('the default AI model has no price, so every call against it will be refused', {
      provider: provider.name,
      model,
      fix: 'add it to AI_MODEL_PRICES, or set AI_DEFAULT_MODEL to a model that has a price',
    });
  }
}

function chooseAiProvider(config: ReturnType<typeof loadConfig>): AiProvider | null {
  switch (config.AI_PROVIDER) {
    case 'anthropic': {
      if (!config.ANTHROPIC_API_KEY) {
        throw new Error('AI_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set');
      }
      return anthropicProvider({
        apiKey: config.ANTHROPIC_API_KEY,
        ...(config.ANTHROPIC_BASE_URL ? { baseUrl: config.ANTHROPIC_BASE_URL } : {}),
      });
    }
    case 'stub': {
      if (config.NODE_ENV === 'production') {
        throw new Error('AI_PROVIDER is stub, which answers without a model and is not a deployment option');
      }
      return stubProvider();
    }
    default: {
      // Unset. Outside production the stub is registered anyway, so a
      // developer who has configured nothing still gets a working suggestion
      // surface; in production nothing is registered and every capability that
      // calls a model refuses with a 503 naming the configuration.
      if (config.NODE_ENV !== 'production') return stubProvider();
      logger.warn('no AI provider is configured; every capability that calls a model will refuse');
      return null;
    }
  }
}

export { modules, registerModule };
