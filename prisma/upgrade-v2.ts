/**
 * One-time, idempotent upgrade for tenants created before Phase 2:
 *  - adds new permissions to system roles (keeps any customisation already made)
 *  - installs approval policies, message templates, starter workflows, knowledge docs and the industry pack
 *  - encrypts any plaintext TOTP secrets
 * Run: npx tsx prisma/upgrade-v2.ts
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLES } from "../lib/rbac";
import { DEFAULT_TEMPLATES } from "../lib/messaging";
import { RECIPES } from "../lib/workflow-recipes";
import { STARTER_RECIPES, STARTER_KB } from "../lib/tenant-setup";
import { applyPack, packForBusiness } from "../lib/industry";
import { encrypt } from "../lib/security";

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany();
  for (const t of tenants) {
    for (const def of DEFAULT_ROLES) {
      const role = await prisma.role.findFirst({ where: { tenantId: t.id, key: def.key } });
      if (!role) continue;
      const perms = { ...def.permissions, ...(role.permissions as Record<string, string>) };
      if (JSON.stringify(perms) !== JSON.stringify(role.permissions)) await prisma.role.update({ where: { id: role.id }, data: { permissions: perms } });
    }
    if (!(await prisma.approvalPolicy.count({ where: { tenantId: t.id } }))) {
      await prisma.approvalPolicy.createMany({ data: [
        { tenantId: t.id, entity: "expense", name: "Expenses (any amount)", minAmount: 0n, levels: ["manager"] },
        { tenantId: t.id, entity: "expense", name: "Expenses ₹10,000+", minAmount: 1_000_000n, levels: ["manager", "accountant"] },
        { tenantId: t.id, entity: "leave", name: "Leave", minAmount: 0n, levels: ["manager"] },
        { tenantId: t.id, entity: "purchase_order", name: "Purchase orders", minAmount: 0n, levels: ["admin"] },
      ] });
    }
    if (!(await prisma.messageTemplate.count({ where: { tenantId: t.id } }))) {
      await prisma.messageTemplate.createMany({ data: DEFAULT_TEMPLATES.map((m) => ({ tenantId: t.id, name: m.name, channel: m.channel, subject: m.subject ?? null, body: m.body })) });
    }
    if (!(await prisma.workflow.count({ where: { tenantId: t.id } }))) {
      for (const key of STARTER_RECIPES) {
        const r = RECIPES.find((x) => x.key === key)!;
        if (r.industries && !r.industries.includes(t.businessType)) continue;
        await prisma.workflow.create({ data: { tenantId: t.id, name: r.name, description: r.description, trigger: r.trigger, triggerConfig: (r.triggerConfig ?? {}) as object, conditions: (r.conditions ?? []) as object, steps: r.steps as object, recipeKey: r.key } });
      }
    }
    if (!(await prisma.knowledgeDoc.count({ where: { tenantId: t.id } }))) await prisma.knowledgeDoc.createMany({ data: STARTER_KB.map((d) => ({ ...d, tenantId: t.id })) });
    const pack = packForBusiness(t.businessType);
    if (pack && !(await prisma.customObject.count({ where: { tenantId: t.id } }))) await applyPack(prisma, t.id, pack);
    console.log(`upgraded ${t.name}`);
  }
  for (const u of await prisma.user.findMany({ where: { totpSecret: { not: null } } })) {
    if (!u.totpSecret!.startsWith("enc:v1:")) await prisma.user.update({ where: { id: u.id }, data: { totpSecret: encrypt(u.totpSecret!) } });
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
