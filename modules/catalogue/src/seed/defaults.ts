import { newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * The catalogue a tenant starts with.
 *
 * One service and one published request, with a form that exercises the parts
 * people get wrong: a conditional field, a required field behind that
 * condition, and a select with real options. It is the worked example the admin
 * builder links to, so the fastest way to learn the format is to open one that
 * already works.
 */
const ACCESS_FORM = {
  key: 'system-access',
  version: 1,
  title: 'Request access to a system',
  schema: {
    type: 'object',
    properties: {
      system: { type: 'string', title: 'System', enum: ['finance', 'hr', 'crm', 'source-control'] },
      accessLevel: { type: 'string', title: 'Access level', enum: ['read', 'write', 'admin'] },
      justification: { type: 'string', title: 'Why you need it', minLength: 20, maxLength: 2000 },
      until: { type: 'string', title: 'Needed until', format: 'date' },
    },
    required: ['system', 'accessLevel'],
  },
  ui: {
    elements: [
      { kind: 'field', field: 'system', control: 'select', label: 'System',
        options: [
          { value: 'finance', label: 'Finance' },
          { value: 'hr', label: 'HR' },
          { value: 'crm', label: 'CRM' },
          { value: 'source-control', label: 'Source control' },
        ] },
      { kind: 'field', field: 'accessLevel', control: 'select', label: 'Access level',
        options: [
          { value: 'read', label: 'Read only' },
          { value: 'write', label: 'Read and write' },
          { value: 'admin', label: 'Administrator' },
        ] },
      // Administrator access needs a reason; read access does not. The condition
      // is an expression, so the server enforces exactly what the browser showed.
      { kind: 'field', field: 'justification', control: 'longtext', label: 'Why you need it', rows: 4,
        visibleWhen: { ne: [{ var: 'form.accessLevel' }, 'read'] },
        requiredWhen: { eq: [{ var: 'form.accessLevel' }, 'admin'] } },
      { kind: 'field', field: 'until', control: 'date', label: 'Needed until' },
    ],
  },
} as const;

export async function seedCatalogueDefaults(ctx: TenantContext): Promise<{ created: number }> {
  return transaction(ctx, async (tx) => {
    const existing = await tx.requestType.findFirst({ where: { key: 'system-access' } });
    if (existing) return { created: 0 };

    const form = await tx.formDefinitionRecord.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: ACCESS_FORM.key,
        name: 'System access request',
        description: 'Collects which system, what level of access, and why.',
        document: ACCESS_FORM as never,
        status: 'published',
        version: 1,
        publishedAt: new Date(),
      },
    });
    await tx.formVersionRecord.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        definitionId: form.id,
        version: 1,
        document: ACCESS_FORM as never,
      },
    });

    const service = await tx.service.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: 'business-applications',
        name: 'Business applications',
        description: 'The systems the organisation runs on.',
      },
    });

    await tx.requestType.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        serviceId: service.id,
        key: 'system-access',
        name: 'Access to a system',
        description: 'Ask for access to a business application.',
        shortSummary: 'Finance, HR, CRM or source control',
        formKey: ACCESS_FORM.key,
        priority: 'P3',
        status: 'published',
        sortOrder: 10,
        publishedAt: new Date(),
      },
    });

    return { created: 1 };
  });
}
