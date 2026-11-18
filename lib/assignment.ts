import { prisma } from "./prisma";
import { notify } from "./notify";

/**
 * Lead assignment engine (BRD §13).
 * Rules are evaluated by priority; the first rule whose conditions all match wins.
 * Strategies: round_robin (atomic cursor) | least_workload (fewest open leads).
 */
export type Condition = { field: string; op: "eq" | "neq" | "in" | "contains" | "gte" | "lte"; value: string };

export function matches(conds: Condition[], data: Record<string, unknown>) {
  return conds.every((c) => {
    const raw = data[c.field];
    const v = raw == null ? "" : String(raw).toLowerCase();
    const target = String(c.value ?? "").toLowerCase();
    switch (c.op) {
      case "eq": return v === target;
      case "neq": return v !== target;
      case "in": return target.split(",").map((s) => s.trim()).includes(v);
      case "contains": return v.includes(target);
      case "gte": return Number(raw) >= Number(c.value);
      case "lte": return Number(raw) <= Number(c.value);
      default: return false;
    }
  });
}

export async function autoAssignLead(tenantId: string, leadId: string): Promise<string | null> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead || lead.ownerId) return lead?.ownerId ?? null;
  const rules = await prisma.assignmentRule.findMany({ where: { tenantId, isActive: true }, orderBy: { priority: "asc" } });
  const data = { ...lead, budget: lead.budget ? Number(lead.budget) / 100 : 0 };

  for (const rule of rules) {
    if (!matches((rule.conditions as Condition[]) ?? [], data)) continue;
    const pool = await prisma.membership.findMany({
      where: { tenantId, id: { in: rule.memberIds }, status: "active", isAvailable: true },
      orderBy: { createdAt: "asc" },
    });
    if (!pool.length) continue;

    let chosen = pool[0].id;
    if (rule.strategy === "least_workload") {
      const loads = await prisma.lead.groupBy({
        by: ["ownerId"], where: { tenantId, ownerId: { in: pool.map((p) => p.id) }, status: { in: ["new", "contacted", "qualified"] } },
        _count: true,
      });
      const load = (id: string) => loads.find((l) => l.ownerId === id)?._count ?? 0;
      chosen = [...pool].sort((a, b) => load(a.id) - load(b.id))[0].id;
    } else {
      // atomic cursor bump → no double assignment under concurrency
      const [{ cursor }] = await prisma.$queryRaw<{ cursor: number }[]>`
        UPDATE "AssignmentRule" SET "cursor" = "cursor" + 1 WHERE "id" = ${rule.id} RETURNING "cursor"`;
      chosen = pool[(Number(cursor) - 1) % pool.length].id;
    }

    await prisma.lead.update({ where: { id: lead.id }, data: { ownerId: chosen, assignedAt: new Date() } });
    await prisma.activity.create({
      data: { tenantId, leadId: lead.id, type: "system", body: `Auto-assigned by rule “${rule.name}” (${rule.strategy.replace("_", " ")})` },
    });
    await notify(tenantId, chosen, `New lead assigned: ${lead.name}`, `${lead.source.replace("_", " ")} · ${lead.city ?? ""}`, `/leads/${lead.id}`);
    return chosen;
  }
  return null;
}
