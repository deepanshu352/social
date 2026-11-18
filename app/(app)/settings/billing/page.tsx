import { revalidatePath } from "next/cache";
import { authorize, requireCtx, has } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { PLANS, planByKey } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { inr } from "@/lib/money";
import { daysAgo, fmtDate, str } from "@/lib/utils";
import { redirect } from "next/navigation";
import { guarded } from "@/lib/action";

export const metadata = { title: "Plan & billing" };

/**
 * Mock checkout. Production: create a Razorpay/Stripe subscription here, and flip the tenant
 * to `active` from the payment gateway's webhook instead of immediately.
 */
async function choosePlan(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("billing.manage", { write: false });
  const plan = planByKey(str(fd.get("plan")));
  const seats = Math.max(1, Number(fd.get("seats")) || ctx.tenant.seats);
  if (plan.key === "enterprise") throw new Error("Contact sales for Enterprise.");
  const active = await prisma.membership.count({ where: { tenantId: ctx.tenant.id, status: "active" } });
  if (seats < active) throw new Error(`You have ${active} active users — disable some or choose at least ${active} seats.`);
  if (seats > plan.limits.users) throw new Error(`${plan.name} allows up to ${plan.limits.users} users.`);
  const data = { plan: plan.key, seats, status: "active" as const, trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 30 * 86400_000) };
  await prisma.tenant.update({ where: { id: ctx.tenant.id }, data });
  await audit(ctx, "billing.plan_change", "Tenant", ctx.tenant.id, { plan: ctx.tenant.plan, seats: ctx.tenant.seats, status: ctx.tenant.status }, data);
  revalidatePath("/", "layout");
  redirect("/settings/billing?ok=1");
});
}

export default async function Billing({ searchParams }: { searchParams: Promise<{ suspended?: string; ok?: string }> }) {
  const ctx = await requireCtx();
  if (!has(ctx, "billing.manage")) redirect("/denied?p=billing.manage");
  const sp = await searchParams;
  const since = daysAgo(30);
  const [users, callMin, ai, aiByFeature] = await Promise.all([
    ctx.db.membership.count({ where: { status: "active" } }),
    ctx.db.callLog.aggregate({ where: { startedAt: { gte: since } }, _sum: { talkSeconds: true } }),
    ctx.db.aiUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true }, _count: true }),
    ctx.db.aiUsage.groupBy({ by: ["feature"], where: { createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true }, _count: true }),
  ]);
  const plan = ctx.plan;
  const meters = [
    { label: "Users", used: users, limit: Math.min(ctx.tenant.seats, plan.limits.users) },
    { label: "Call minutes (30d)", used: Math.round((callMin._sum.talkSeconds ?? 0) / 60), limit: plan.limits.callMinutes },
    { label: "AI requests (30d)", used: ai._count, limit: plan.limits.aiRequests },
  ];
  return (
    <>
      <PageHeader title="Plan & billing" subtitle={<>Current plan: <b>{plan.name}</b> · <StatusBadge status={ctx.tenant.status} /> {ctx.tenant.trialEndsAt && ` · trial ends ${fmtDate(ctx.tenant.trialEndsAt)}`}{ctx.tenant.currentPeriodEnd && ` · renews ${fmtDate(ctx.tenant.currentPeriodEnd)}`}</>} />
      {sp.suspended && <Card className="mb-6 border-red-200 bg-red-50/50"><p className="text-sm">Your workspace is suspended. Choose a plan to restore access — your data is safe.</p></Card>}
      {sp.ok && <Card className="mb-6 border-green-200 bg-green-50/50"><p className="text-sm">Plan updated. Thank you!</p></Card>}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {meters.map((m) => {
          const pct = m.limit ? Math.min(100, (m.used / m.limit) * 100) : 0;
          return (
            <Card key={m.label}>
              <div className="text-xs font-medium text-muted">{m.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{m.used.toLocaleString("en-IN")} <span className="text-sm font-normal text-muted">/ {m.limit ? m.limit.toLocaleString("en-IN") : "not included"}</span></div>
              <div className="mt-2 h-2 rounded-full bg-gray-100"><div className={`h-2 rounded-full ${pct > 90 ? "bg-red-600" : "bg-brand-500"}`} style={{ width: `${pct}%` }} /></div>
            </Card>
          );
        })}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-4">
        {PLANS.map((p) => (
          <Card key={p.key} className={p.key === plan.key ? "border-brand-500 ring-2 ring-brand-100" : ""}>
            <div className="flex items-center justify-between font-semibold">{p.name} {p.key === plan.key && <Badge tone="blue">Current</Badge>}</div>
            <div className="mt-1 text-2xl font-semibold">{p.pricePerUser ? inr(p.pricePerUser, false) : "Custom"}<span className="text-xs font-normal text-muted">{p.pricePerUser ? " /user/month" : ""}</span></div>
            <p className="mt-1 text-xs text-muted">{p.tagline}</p>
            <ul className="mt-3 space-y-0.5 text-xs">{p.modules.map((m) => <li key={m}>✓ {m}</li>)}<li className="text-muted">Up to {p.limits.users.toLocaleString("en-IN")} users</li></ul>
            {p.key !== "enterprise" ? (
              <form action={choosePlan} className="mt-4 flex gap-2">
                <input type="hidden" name="plan" value={p.key} />
                <input name="seats" type="number" min={1} defaultValue={Math.max(users, ctx.tenant.seats)} className="input w-20 py-1.5" aria-label="Seats" />
                <SubmitButton className={p.key === plan.key ? "btn-secondary btn-sm" : "btn-primary btn-sm"}>{p.key === plan.key ? "Update seats" : "Choose"}</SubmitButton>
              </form>
            ) : <a href="mailto:sales@example.com" className="btn-secondary btn-sm mt-4">Contact sales</a>}
          </Card>
        ))}
      </div>

      <Card title="AI usage & cost · last 30 days" pad={false}>
        <table className="table">
          <thead><tr><th>Feature</th><th className="text-right">Requests</th><th className="text-right">Input tokens</th><th className="text-right">Output tokens</th><th className="text-right">Est. cost (USD)</th></tr></thead>
          <tbody>
            {aiByFeature.map((f) => <tr key={f.feature}><td>{f.feature}</td><td className="text-right tabular-nums">{f._count}</td><td className="text-right tabular-nums">{(f._sum.inputTokens ?? 0).toLocaleString()}</td><td className="text-right tabular-nums">{(f._sum.outputTokens ?? 0).toLocaleString()}</td><td className="text-right tabular-nums">${((f._sum.costMicroUsd ?? 0) / 1e6).toFixed(4)}</td></tr>)}
            <tr className="font-semibold"><td>Total</td><td className="text-right">{ai._count}</td><td className="text-right">{(ai._sum.inputTokens ?? 0).toLocaleString()}</td><td className="text-right">{(ai._sum.outputTokens ?? 0).toLocaleString()}</td><td className="text-right">${((ai._sum.costMicroUsd ?? 0) / 1e6).toFixed(4)}</td></tr>
          </tbody>
        </table>
      </Card>
    </>
  );
}
