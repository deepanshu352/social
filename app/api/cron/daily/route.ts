import { prisma } from "@/lib/prisma";
import { json, jsonError } from "@/lib/api";
import { emit } from "@/lib/events";
import { notify } from "@/lib/notify";
import { GRACE_DAYS } from "@/lib/plans";

/**
 * Daily jobs (call from Vercel Cron / GitHub Actions / k8s CronJob with Authorization: Bearer $CRON_SECRET):
 *  - mark overdue invoices + emit invoice.overdue (automations / reminders)
 *  - mark missed follow-ups
 *  - expire quotations past validity
 *  - trial → grace → restricted lifecycle (BRD §83)
 */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return jsonError("UNAUTHORIZED", "Bad cron secret", 401);
  const now = new Date();
  const overdue = await prisma.invoice.findMany({ where: { status: { in: ["issued", "partially_paid"] }, dueDate: { lt: now } } });
  for (const inv of overdue) {
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "overdue" } });
    await emit(inv.tenantId, "invoice.overdue", { id: inv.id, number: inv.number, balance: inv.balance, contactId: inv.contactId, ownerId: inv.ownerId });
    await notify(inv.tenantId, inv.ownerId, `Invoice ${inv.number} is overdue`, `Balance ₹${(Number(inv.balance) / 100).toLocaleString("en-IN")}`, `/invoices/${inv.id}`);
  }
  const toMiss = await prisma.followUp.findMany({ where: { status: "pending", dueAt: { lt: new Date(now.getTime() - 24 * 3600_000) } }, take: 1000 });
  const missed = await prisma.followUp.updateMany({ where: { id: { in: toMiss.map((f) => f.id) } }, data: { status: "missed" } });
  for (const f of toMiss) await emit(f.tenantId, "followup.missed", { id: f.id, leadId: f.leadId, contactId: f.contactId, ownerId: f.assigneeId });
  const expired = await prisma.quotation.updateMany({ where: { status: { in: ["approved", "sent", "viewed"] }, validUntil: { lt: now } }, data: { status: "expired" } });
  const toGrace = await prisma.tenant.updateMany({ where: { status: "trial", trialEndsAt: { lt: now } }, data: { status: "grace" } });
  const toRestricted = await prisma.tenant.updateMany({ where: { status: "grace", trialEndsAt: { lt: new Date(now.getTime() - GRACE_DAYS * 86400_000) } }, data: { status: "restricted" } });
  return json({ overdueInvoices: overdue.length, missedFollowUps: missed.count, expiredQuotations: expired.count, toGrace: toGrace.count, toRestricted: toRestricted.count });
}
