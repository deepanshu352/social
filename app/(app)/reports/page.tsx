import { guard } from "@/lib/auth";
import { Card, PageHeader, BarChart, HBars, Stat } from "@/components/ui";
import { inr, inrCompact, toNum } from "@/lib/money";
import { daysAgo, fmtDuration, titleCase } from "@/lib/utils";

export const metadata = { title: "Reports" };

export default async function Reports({ searchParams }: { searchParams: Promise<{ days?: string; branch?: string }> }) {
  const ctx = await guard("report.view", "reports");
  const sp = await searchParams;
  const days = Number(sp.days) || 30;
  const since = daysAgo(days);
  const db = ctx.db;
  const branchF = sp.branch ? { branchId: sp.branch } : {};
  const [branches, members, leads, bySource, byStatus, calls, invoices, payments, won, stages] = await Promise.all([
    db.branch.findMany(),
    db.membership.findMany({ where: { status: "active", ...(sp.branch ? { branchId: sp.branch } : {}) }, include: { user: true, role: true } }),
    db.lead.findMany({ where: { createdAt: { gte: since }, deletedAt: null, ...branchF }, select: { createdAt: true, firstResponseAt: true, status: true, ownerId: true } }),
    db.lead.groupBy({ by: ["source"], where: { createdAt: { gte: since }, deletedAt: null, ...branchF }, _count: true }),
    db.lead.groupBy({ by: ["source", "status"], where: { createdAt: { gte: since }, deletedAt: null, ...branchF }, _count: true }),
    db.callLog.findMany({ where: { startedAt: { gte: since } }, select: { agentId: true, talkSeconds: true, disposition: true } }),
    db.invoice.findMany({ where: { issueDate: { gte: since }, status: { notIn: ["draft", "cancelled"] }, ...branchF }, select: { total: true, issueDate: true, ownerId: true, items: { select: { description: true, taxable: true } } } }),
    db.payment.aggregate({ where: { receivedOn: { gte: since } }, _sum: { amount: true } }),
    db.deal.findMany({ where: { closedAt: { gte: since }, ...branchF }, include: { stage: true } }),
    db.pipelineStage.findMany({ orderBy: { order: "asc" } }),
  ]);
  const resp = leads.filter((l) => l.firstResponseAt).map((l) => (l.firstResponseAt!.getTime() - l.createdAt.getTime()) / 60000).sort((a, b) => a - b);
  const median = resp.length ? Math.round(resp[Math.floor(resp.length / 2)]) : null;
  const revenue = invoices.reduce((a, i) => a + toNum(i.total), 0);
  const weeks = Math.min(12, Math.ceil(days / 7));
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const end = new Date(Date.now() - (weeks - 1 - i) * 7 * 86400_000), start = new Date(end.getTime() - 7 * 86400_000);
    return { label: end.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), value: invoices.filter((x) => x.issueDate > start && x.issueDate <= end).reduce((a, x) => a + toNum(x.total), 0) };
  });
  const productRev = new Map<string, number>();
  invoices.forEach((i) => i.items.forEach((it) => productRev.set(it.description, (productRev.get(it.description) ?? 0) + toNum(it.taxable))));
  const funnel = [
    { label: "All new leads", value: leads.length },
    { label: "Contacted", value: leads.filter((l) => l.firstResponseAt || ["contacted", "qualified", "converted"].includes(l.status)).length },
    { label: "Qualified", value: leads.filter((l) => ["qualified", "converted"].includes(l.status)).length },
    { label: "Converted", value: leads.filter((l) => l.status === "converted").length },
  ];
  const wonDeals = won.filter((d) => d.stage.type === "won"), lostDeals = won.filter((d) => d.stage.type === "lost");

  return (
    <>
      <PageHeader title="Reports" subtitle={`Last ${days} days${sp.branch ? ` · ${branches.find((b) => b.id === sp.branch)?.name}` : " · all branches"}`} actions={
        <form className="flex gap-2" action="/reports">
          <select name="days" defaultValue={String(days)} className="input w-auto"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">6 months</option><option value="365">12 months</option></select>
          <select name="branch" defaultValue={sp.branch ?? ""} className="input w-auto"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <button className="btn-secondary">Apply</button>
        </form>} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Revenue invoiced" value={inrCompact(revenue)} hint={`${invoices.length} invoices`} />
        <Stat label="Collected" value={inrCompact(payments._sum.amount)} hint={revenue ? `${Math.round((toNum(payments._sum.amount) / revenue) * 100)}% collection rate` : undefined} />
        <Stat label="New leads" value={leads.length} hint={`${leads.filter((l) => l.status === "converted").length} converted`} />
        <Stat label="Median first response" value={median != null ? (median < 60 ? `${median} min` : `${(median / 60).toFixed(1)} h`) : "—"} tone={median != null && median > 120 ? "warn" : undefined} />
        <Stat label="Win rate" value={wonDeals.length + lostDeals.length ? `${Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100)}%` : "—"} hint={`${wonDeals.length} won · ${lostDeals.length} lost`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Revenue by week"><BarChart label="Invoiced revenue by week" data={weekly} format={inrCompact} /></Card>
        <Card title="Lead funnel"><HBars data={funnel} /></Card>
        <Card title="Leads by source (with conversion)">
          <HBars data={bySource.sort((a, b) => b._count - a._count).map((s) => {
            const conv = byStatus.find((x) => x.source === s.source && x.status === "converted")?._count ?? 0;
            return { label: titleCase(s.source), value: s._count, sub: `${Math.round((conv / s._count) * 100)}% conv.` };
          })} />
        </Card>
        <Card title="Top products by revenue (taxable)"><HBars data={[...productRev.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} format={inrCompact} /></Card>
        <Card title="Team performance" pad={false} className="lg:col-span-2">
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Member</th><th>Role</th><th className="text-right">Leads owned</th><th className="text-right">Converted</th><th className="text-right">Calls</th><th className="text-right">Connected</th><th className="text-right">Talk time</th><th className="text-right">Invoiced</th></tr></thead>
            <tbody>{members.map((m) => {
              const mc = calls.filter((c) => c.agentId === m.id), conn = mc.filter((c) => c.talkSeconds > 0);
              const ml = leads.filter((l) => l.ownerId === m.id);
              return (
                <tr key={m.id}>
                  <td className="font-medium">{m.user.name}</td><td className="text-muted">{m.role.name}</td>
                  <td className="text-right tabular-nums">{ml.length}</td><td className="text-right tabular-nums">{ml.filter((l) => l.status === "converted").length}</td>
                  <td className="text-right tabular-nums">{mc.length}</td><td className="text-right tabular-nums">{mc.length ? `${Math.round((conn.length / mc.length) * 100)}%` : "—"}</td>
                  <td className="text-right tabular-nums">{fmtDuration(mc.reduce((a, c) => a + c.talkSeconds, 0))}</td>
                  <td className="text-right tabular-nums">{inr(invoices.filter((i) => i.ownerId === m.id).reduce((a, i) => a + toNum(i.total), 0), false)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
        <Card title="Stage probabilities" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2 text-sm">{stages.map((s) => <span key={s.id} className="rounded-lg bg-gray-50 px-3 py-1.5">{s.name} · {s.probability}%</span>)}</div>
          <p className="mt-3 text-xs text-muted">Live deal values are on the <a className="link" href="/pipeline">pipeline board</a>.</p>
        </Card>
      </div>
    </>
  );
}
