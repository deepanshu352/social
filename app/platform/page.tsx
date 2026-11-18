import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PLANS, planByKey } from "@/lib/plans";
import { Card, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { logout } from "@/app/actions";
import { audit } from "@/lib/audit";
import { inr, inrCompact } from "@/lib/money";
import { daysAgo, fmtDate, str, timeAgo } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Platform admin" };

async function requireAdmin() {
  const s = await getSessionUser();
  if (!s?.user.isPlatformAdmin) redirect("/login");
  return s;
}

async function tenantOp(id: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const s = await requireAdmin();
  const op = str(fd.get("op"));
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id } });
  const data =
    op === "suspend" ? { status: "suspended" as const } :
    op === "activate" ? { status: "active" as const, currentPeriodEnd: new Date(Date.now() + 30 * 86400_000) } :
    op === "extend" ? { status: "trial" as const, trialEndsAt: new Date(Math.max(Date.now(), t.trialEndsAt?.getTime() ?? 0) + 7 * 86400_000) } :
    op === "plan" ? { plan: str(fd.get("plan")) } : null;
  if (!data) return;
  await prisma.tenant.update({ where: { id }, data });
  // Platform actions are recorded in the tenant's own audit trail (BRD §87: access must be logged).
  await audit({ tenantId: id, actorName: `Platform: ${s.user.name}`, actorType: "platform", actorId: s.userId }, `platform.${op}`, "Tenant", id, { status: t.status, plan: t.plan }, data);
  revalidatePath("/platform");
});
}

export default async function Platform() {
  const s = await requireAdmin();
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { memberships: true, leads: true, invoices: true } } } });
  const [calls, ai, activeUsers] = await Promise.all([
    prisma.callLog.aggregate({ where: { startedAt: { gte: daysAgo(30) } }, _sum: { talkSeconds: true }, _count: true }),
    prisma.aiUsage.aggregate({ where: { createdAt: { gte: daysAgo(30) } }, _sum: { costMicroUsd: true }, _count: true }),
    prisma.session.groupBy({ by: ["userId"], where: { lastSeenAt: { gte: daysAgo(7) } } }),
  ]);
  const mrr = tenants.filter((t) => t.status === "active").reduce((a, t) => a + planByKey(t.plan).pricePerUser * t.seats, 0);
  const count = (st: string) => tenants.filter((t) => t.status === st).length;
  const myTenant = s.tenantId;
  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <PageHeader title="Platform admin" subtitle="SaaS owner console — tenant business data is not shown here."
        actions={<>{myTenant && <Link href="/dashboard" className="btn-secondary">Back to app</Link>}<form action={logout}><button className="btn-ghost">Sign out</button></form></>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
        <Stat label="Companies" value={tenants.length} />
        <Stat label="Paid" value={count("active")} />
        <Stat label="Trial" value={count("trial")} hint={`${count("grace")} in grace`} />
        <Stat label="MRR" value={inrCompact(mrr)} hint={`ARR ${inrCompact(mrr * 12)}`} />
        <Stat label="Call minutes (30d)" value={Math.round((calls._sum.talkSeconds ?? 0) / 60).toLocaleString("en-IN")} hint={`${calls._count} calls`} />
        <Stat label="AI cost (30d)" value={`$${((ai._sum.costMicroUsd ?? 0) / 1e6).toFixed(2)}`} hint={`${ai._count} requests · ${activeUsers.length} WAU`} />
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Company</th><th>Status</th><th>Plan</th><th className="text-right">Users</th><th className="text-right">Leads</th><th className="text-right">MRR</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>{tenants.map((t) => (
            <tr key={t.id}>
              <td><div className="font-medium">{t.name}</div><div className="text-xs text-muted">{t.slug} · {t.businessType}</div></td>
              <td><StatusBadge status={t.status} />{t.trialEndsAt && t.status === "trial" && <div className="text-xs text-muted">ends {fmtDate(t.trialEndsAt)}</div>}</td>
              <td>{planByKey(t.plan).name} · {t.seats} seats</td>
              <td className="text-right">{t._count.memberships}</td><td className="text-right">{t._count.leads}</td>
              <td className="text-right tabular-nums">{t.status === "active" ? inr(planByKey(t.plan).pricePerUser * t.seats, false) : "—"}</td>
              <td className="text-xs">{timeAgo(t.createdAt)}</td>
              <td>
                <form action={tenantOp.bind(null, t.id)} className="flex flex-wrap gap-1">
                  {t.status !== "suspended" ? <SubmitButton name="op" value="suspend" className="btn-ghost btn-sm text-red-700" confirm={`Suspend ${t.name}?`}>Suspend</SubmitButton> : <SubmitButton name="op" value="activate" className="btn-secondary btn-sm">Reactivate</SubmitButton>}
                  {["trial", "grace", "restricted"].includes(t.status) && <SubmitButton name="op" value="extend" className="btn-ghost btn-sm">+7d trial</SubmitButton>}
                  <select name="plan" defaultValue={t.plan} className="input w-28 py-1 text-xs">{PLANS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
                  <SubmitButton name="op" value="plan" className="btn-ghost btn-sm">Set plan</SubmitButton>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
