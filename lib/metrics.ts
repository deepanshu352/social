import type { Ctx } from "./auth";
import { has, scopeWhere } from "./auth";
import { inrCompact, toNum } from "./money";
import { daysAgo, startOfDay } from "./utils";

export type Insight = { severity: "info" | "warning" | "critical"; text: string; href?: string };

/** Dashboard metrics, permission-filtered (a telecaller never gets revenue). */
export async function dashboardMetrics(ctx: Ctx) {
  const db = ctx.db;
  const today = startOfDay();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const leadW = { ...(await scopeWhere(ctx, "lead.view")), deletedAt: null };
  const callW = await scopeWhere(ctx, "call.view", "agentId", null);
  const fuW = await scopeWhere(ctx, "followup.view", "assigneeId", null);

  const [newLeads7, hotNoFollow, convertedMonth, totalLeadsMonth, callsToday, connectedToday, talkToday, fuDue, fuOverdue, uncontacted] = await Promise.all([
    db.lead.count({ where: { ...leadW, createdAt: { gte: daysAgo(7) } } }),
    db.lead.count({ where: { ...leadW, scoreBand: "hot", nextFollowUpAt: null, status: { in: ["new", "contacted", "qualified"] } } }),
    db.lead.count({ where: { ...leadW, status: "converted", updatedAt: { gte: monthStart } } }),
    db.lead.count({ where: { ...leadW, createdAt: { gte: monthStart } } }),
    has(ctx, "call.view") ? db.callLog.count({ where: { ...callW, startedAt: { gte: today } } }) : 0,
    has(ctx, "call.view") ? db.callLog.count({ where: { ...callW, startedAt: { gte: today }, talkSeconds: { gt: 0 } } }) : 0,
    has(ctx, "call.view") ? db.callLog.aggregate({ where: { ...callW, startedAt: { gte: today } }, _sum: { talkSeconds: true } }) : null,
    db.followUp.count({ where: { ...fuW, status: "pending", dueAt: { gte: today, lt: new Date(today.getTime() + 86400_000) } } }),
    db.followUp.count({ where: { ...fuW, status: "pending", dueAt: { lt: new Date() } } }),
    db.lead.count({ where: { ...leadW, status: "new", firstResponseAt: null, createdAt: { lt: new Date(Date.now() - 2 * 3600_000) } } }),
  ]);

  let finance: null | { invoicedMonth: number; collectedMonth: number; outstanding: number; overdue: number; overdueCount: number; pipelineOpen: number; monthly: { label: string; value: number }[] } = null;
  if (has(ctx, "report.view")) {
    const [inv, paid, out, od, pipe, sixMonths] = await Promise.all([
      db.invoice.aggregate({ where: { issueDate: { gte: monthStart }, status: { notIn: ["draft", "cancelled"] } }, _sum: { total: true } }),
      db.payment.aggregate({ where: { receivedOn: { gte: monthStart } }, _sum: { amount: true } }),
      db.invoice.aggregate({ where: { status: { in: ["issued", "partially_paid", "overdue"] } }, _sum: { balance: true } }),
      db.invoice.aggregate({ where: { status: { in: ["issued", "partially_paid", "overdue"] }, dueDate: { lt: today } }, _sum: { balance: true }, _count: true }),
      db.deal.aggregate({ where: { stage: { type: "open" } }, _sum: { amount: true } }),
      db.invoice.findMany({ where: { issueDate: { gte: new Date(today.getFullYear(), today.getMonth() - 5, 1) }, status: { notIn: ["draft", "cancelled"] } }, select: { issueDate: true, total: true } }),
    ]);
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - 5 + i, 1);
      const value = sixMonths.filter((x) => x.issueDate.getMonth() === d.getMonth() && x.issueDate.getFullYear() === d.getFullYear()).reduce((a, x) => a + toNum(x.total), 0);
      return { label: d.toLocaleString("en-IN", { month: "short" }), value };
    });
    finance = {
      invoicedMonth: toNum(inv._sum.total), collectedMonth: toNum(paid._sum.amount), outstanding: toNum(out._sum.balance),
      overdue: toNum(od._sum.balance), overdueCount: od._count, pipelineOpen: toNum(pipe._sum.amount), monthly,
    };
  }

  const bySource = await db.lead.groupBy({ by: ["source"], where: { ...leadW, createdAt: { gte: daysAgo(30) } }, _count: true });
  const lowStock = has(ctx, "product.view") ? await db.product.findMany({ where: { isActive: true, type: "goods", minStock: { gt: 0 } }, select: { name: true, stock: true, minStock: true } }) : [];

  return {
    newLeads7, hotNoFollow, convertedMonth, totalLeadsMonth, conversionRate: totalLeadsMonth ? Math.round((convertedMonth / totalLeadsMonth) * 100) : 0,
    callsToday, connectedToday, talkMinutesToday: Math.round((talkToday?._sum.talkSeconds ?? 0) / 60),
    fuDue, fuOverdue, uncontacted, finance,
    bySource: bySource.map((s) => ({ label: s.source.replace(/_/g, " "), value: s._count })).sort((a, b) => b.value - a.value),
    lowStock: lowStock.filter((p) => p.stock <= p.minStock),
  };
}

/** Rule-based AI Business Summary (BRD §10 / §95). Same contract the LLM briefing fills. */
export function insightsFrom(m: Awaited<ReturnType<typeof dashboardMetrics>>): Insight[] {
  const out: Insight[] = [];
  if (m.hotNoFollow) out.push({ severity: "warning", text: `${m.hotNoFollow} hot lead${m.hotNoFollow > 1 ? "s have" : " has"} no follow-up scheduled.`, href: "/leads?band=hot&nofollow=1" });
  if (m.uncontacted) out.push({ severity: "warning", text: `${m.uncontacted} new lead${m.uncontacted > 1 ? "s" : ""} not contacted within 2 hours of arriving.`, href: "/leads?status=new" });
  if (m.fuOverdue) out.push({ severity: m.fuOverdue > 10 ? "critical" : "warning", text: `${m.fuOverdue} follow-up${m.fuOverdue > 1 ? "s are" : " is"} overdue.`, href: "/followups?tab=overdue" });
  if (m.finance?.overdue) out.push({ severity: m.finance.overdue > 20000000 ? "critical" : "warning", text: `${inrCompact(m.finance.overdue)} of invoices are overdue across ${m.finance.overdueCount} invoice${m.finance.overdueCount > 1 ? "s" : ""}.`, href: "/invoices?tab=overdue" });
  for (const p of m.lowStock.slice(0, 3)) out.push({ severity: "warning", text: `${p.name} is at ${p.stock} units (minimum ${p.minStock}). Reorder soon.`, href: "/products" });
  if (m.finance && m.finance.monthly.length >= 2) {
    const [prev, cur] = m.finance.monthly.slice(-2);
    if (prev.value > 0) {
      const pct = Math.round(((cur.value - prev.value) / prev.value) * 100);
      out.push({ severity: "info", text: `Invoiced revenue this month is ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% vs last month (${inrCompact(cur.value)} vs ${inrCompact(prev.value)}).` });
    }
  }
  if (m.conversionRate) out.push({ severity: "info", text: `Lead conversion this month: ${m.conversionRate}% (${m.convertedMonth} of ${m.totalLeadsMonth}).` });
  if (!out.length) out.push({ severity: "info", text: "All clear — no risks detected right now." });
  return out;
}
