import { prisma } from "./prisma";

export type Finding = { severity: "info" | "warning" | "critical"; title: string; detail: string; href?: string };

/**
 * Rule-based anomaly detection (BRD §77). Findings are flags for review —
 * they never accuse anyone or block work automatically.
 */
export async function securityFindings(tenantId: string, tz: string): Promise<Finding[]> {
  const since7 = new Date(Date.now() - 7 * 86400_000), since1 = new Date(Date.now() - 86400_000);
  const members = await prisma.membership.findMany({ where: { tenantId, status: "active" }, include: { user: true, role: true } });
  const userIds = members.map((m) => m.userId);
  const [failed, locked, logins, audits, bigDiscounts, flagged, staleKeys] = await Promise.all([
    prisma.loginEvent.groupBy({ by: ["email"], where: { success: false, createdAt: { gte: since1 }, OR: [{ tenantId }, { userId: { in: userIds } }] }, _count: true }),
    prisma.user.findMany({ where: { id: { in: userIds }, lockedUntil: { gt: new Date() } } }),
    prisma.loginEvent.findMany({ where: { success: true, userId: { in: userIds }, createdAt: { gte: since7 } } }),
    prisma.auditLog.findMany({ where: { tenantId, createdAt: { gte: since7 }, action: { in: ["lead.export", "data.export_all", "lead.bulk.delete", "invoice.cancel", "dnd.remove", "role.update", "security.policy", "user.update", "apikey.create"] } } }),
    prisma.quotation.findMany({ where: { tenantId, updatedAt: { gte: since7 }, maxDiscountPct: { gte: 20 }, status: { in: ["approved", "sent", "viewed", "accepted", "converted"] } }, select: { number: true, maxDiscountPct: true, id: true } }),
    prisma.expense.findMany({ where: { tenantId, createdAt: { gte: since7 }, NOT: { flags: { isEmpty: true } } }, select: { number: true, flags: true } }),
    prisma.apiKey.findMany({ where: { tenantId, revokedAt: null, createdAt: { lt: new Date(Date.now() - 90 * 86400_000) } } }),
  ]);
  const out: Finding[] = [];
  const admins = members.filter((m) => ["admin", "branch_admin"].includes(m.role.key));
  const no2fa = admins.filter((m) => !m.user.totpEnabled);
  if (no2fa.length) out.push({ severity: "critical", title: `${no2fa.length} admin account(s) without 2FA`, detail: no2fa.map((m) => m.user.name).join(", "), href: "/security#policy" });
  for (const f of failed.filter((f) => f._count >= 5)) out.push({ severity: "critical", title: `Repeated failed sign-ins for ${f.email}`, detail: `${f._count} failures in 24 hours — possible password guessing.` });
  for (const u of locked) out.push({ severity: "warning", title: `${u.name} is temporarily locked out`, detail: `Locked until ${u.lockedUntil?.toLocaleTimeString("en-IN")}.` });
  const hour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d)) % 24;
  const odd = logins.filter((l) => hour(l.createdAt) < 7 || hour(l.createdAt) >= 22);
  if (odd.length) out.push({ severity: "info", title: `${odd.length} sign-in(s) outside 7 AM – 10 PM`, detail: [...new Set(odd.map((l) => l.email))].join(", ") });
  const newDev = logins.filter((l) => l.newDevice);
  if (newDev.length) out.push({ severity: "info", title: `${newDev.length} sign-in(s) from a new device`, detail: [...new Set(newDev.map((l) => `${l.email} (${l.ip ?? "?"})`))].join(", ") });
  const by = (a: string) => audits.filter((x) => x.action === a);
  if (by("lead.export").length + by("data.export_all").length) out.push({ severity: "warning", title: `${by("lead.export").length + by("data.export_all").length} data export(s) this week`, detail: [...new Set([...by("lead.export"), ...by("data.export_all")].map((x) => x.actorName))].join(", "), href: "/settings/audit?q=export" });
  if (by("lead.bulk.delete").length) out.push({ severity: "warning", title: "Bulk lead deletion", detail: `${by("lead.bulk.delete").length} bulk delete(s) by ${[...new Set(by("lead.bulk.delete").map((x) => x.actorName))].join(", ")}`, href: "/settings/audit?q=delete" });
  if (by("invoice.cancel").length >= 3) out.push({ severity: "warning", title: `${by("invoice.cancel").length} invoices cancelled this week`, detail: "Unusually high — review reasons in the audit log.", href: "/settings/audit?q=invoice.cancel" });
  if (by("dnd.remove").length) out.push({ severity: "warning", title: "Numbers removed from Do-Not-Call list", detail: `${by("dnd.remove").length} removal(s). Make sure customer consent exists.`, href: "/settings/audit?q=dnd" });
  if (bigDiscounts.length) out.push({ severity: "info", title: `${bigDiscounts.length} quotation(s) with ≥20% discount`, detail: bigDiscounts.map((q) => `${q.number} (${q.maxDiscountPct}%)`).join(", "), href: "/quotations" });
  if (flagged.length) out.push({ severity: "warning", title: `${flagged.length} expense claim(s) flagged`, detail: flagged.slice(0, 5).map((e) => `EXP-${e.number}: ${e.flags[0]}`).join("; "), href: "/expenses?who=team" });
  if (staleKeys.length) out.push({ severity: "info", title: `${staleKeys.length} API key(s) older than 90 days`, detail: "Rotate long-lived keys.", href: "/settings/api" });
  if (by("role.update").length || by("security.policy").length) out.push({ severity: "info", title: "Permission / policy changes", detail: `${by("role.update").length} role change(s), ${by("security.policy").length} policy change(s) this week.`, href: "/settings/audit?q=role" });
  return out;
}
