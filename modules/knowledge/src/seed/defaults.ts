import { type TenantContext, newId, transaction } from '@itsm/platform';

/**
 * What a new tenant's knowledge base starts with.
 *
 * Categories only, and no articles. A seeded article is a lie in the search
 * results — it looks like the tenant's own knowledge and is not — and the first
 * thing an administrator has to do is work out whether it is safe to delete.
 * Empty categories are an invitation to write; a fake article is a chore.
 */
const CATEGORIES = [
  { key: 'how-to', name: 'How do I…', sortOrder: 10 },
  { key: 'troubleshooting', name: 'Something is not working', sortOrder: 20 },
  { key: 'policies', name: 'Policies and standards', sortOrder: 30 },
  { key: 'runbooks', name: 'Runbooks', sortOrder: 40 },
] as const;

export async function seedKnowledgeDefaults(ctx: TenantContext): Promise<void> {
  await transaction(ctx, async (tx) => {
    for (const category of CATEGORIES) {
      const existing = await tx.knowledgeCategory.findFirst({ where: { key: category.key } });
      if (existing) continue;
      await tx.knowledgeCategory.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: category.key,
          name: category.name,
          parentId: null,
          path: `/${category.key}`,
          sortOrder: category.sortOrder,
        },
      });
    }
  });
}
