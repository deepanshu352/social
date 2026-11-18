import type { Ctx } from "@/lib/auth";
import { ACTIONS, CONDITION_FIELDS, TRIGGERS } from "@/lib/workflows";

export async function builderOpts(ctx: Ctx) {
  const [templates, members, roles] = await Promise.all([
    ctx.db.messageTemplate.findMany({ where: { isActive: true }, select: { id: true, name: true, channel: true }, orderBy: { name: "asc" } }),
    ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }),
    ctx.db.role.findMany({ select: { key: true, name: true } }),
  ]);
  return { triggers: TRIGGERS, actions: ACTIONS, fields: CONDITION_FIELDS, templates, members: members.map((m) => ({ id: m.id, name: m.user.name })), roles };
}
