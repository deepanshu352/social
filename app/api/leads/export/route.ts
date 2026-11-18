import type { Prisma } from "@prisma/client";
import { getCtx, has, scopeWhere } from "@/lib/auth";
import { toCsv } from "@/lib/leads";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx || !has(ctx, "lead.export")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const where: Prisma.LeadWhereInput = { ...(await scopeWhere(ctx, "lead.view")), deletedAt: null };
  if (sp.get("status")) where.status = sp.get("status") as any;
  if (sp.get("source")) where.source = sp.get("source") as any;
  const leads = await ctx.db.lead.findMany({ where, include: { owner: { include: { user: true } } }, orderBy: { number: "asc" }, take: 50000 });
  await audit(ctx, "lead.export", "Lead", null, null, { count: leads.length, filter: Object.fromEntries(sp) });
  const csv = toCsv([
    ["number", "name", "company", "phone", "email", "source", "status", "score", "city", "state", "budget_inr", "owner", "created_at"],
    ...leads.map((l) => [`LD-${l.number}`, l.name, l.companyName, l.phone, l.email, l.source, l.status, l.score, l.city, l.state, l.budget ? Number(l.budget) / 100 : "", l.owner?.user.name, l.createdAt.toISOString()]),
  ]);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="leads-${Date.now()}.csv"` } });
}
