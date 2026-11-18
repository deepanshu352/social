import Link from "next/link";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { requireCtx, has, hasModule, scopeWhere } from "@/lib/auth";
import { dashboardMetrics, insightsFrom } from "@/lib/metrics";
import { inr, inrCompact } from "@/lib/money";
import { aiEnabled } from "@/lib/ai";
import { Card, PageHeader, Stat, BarChart, HBars, Empty, ScoreBadge } from "@/components/ui";
import { AiBriefing } from "./AiBriefing";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const ICON = { info: Info, warning: AlertTriangle, critical: OctagonAlert };
const TONE = { info: "text-brand-600", warning: "text-amber-600", critical: "text-red-600" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const ctx = await requireCtx();
  const { welcome } = await searchParams;
  const m = await dashboardMetrics(ctx);
  const insights = insightsFrom(m);
  const [myFollowups, hotLeads] = await Promise.all([
    ctx.db.followUp.findMany({
      where: { assigneeId: ctx.membership.id, status: "pending", dueAt: { lt: new Date(Date.now() + 86400_000) } },
      include: { lead: true, contact: true }, orderBy: { dueAt: "asc" }, take: 6,
    }),
    has(ctx, "lead.view") ? ctx.db.lead.findMany({ where: { ...(await scopeWhere(ctx, "lead.view")), deletedAt: null, status: { in: ["new", "contacted", "qualified"] } }, orderBy: { score: "desc" }, take: 6 }) : [],
  ]);
  const hour = new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: ctx.tenant.timezone });
  const greet = Number(hour) < 12 ? "Good morning" : Number(hour) < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader title={`${greet}, ${ctx.user.name.split(" ")[0]}`} subtitle={`Here's what's happening at ${ctx.tenant.name} today.`}
        actions={has(ctx, "lead.create") && <Link href="/leads/new" className="btn-primary">+ New lead</Link>} />

      {welcome && (
        <Card className="mb-6 border-brand-100 bg-brand-50/40" title="Get started in 4 steps">
          <ol className="grid gap-3 text-sm md:grid-cols-4">
            <li><Link className="link" href="/settings/users">1. Invite your team →</Link><p className="text-muted">Telecallers, sales, accounts.</p></li>
            <li><Link className="link" href="/leads/import">2. Import leads →</Link><p className="text-muted">CSV from Excel or your old CRM.</p></li>
            <li><Link className="link" href="/settings/assignment">3. Set assignment rules →</Link><p className="text-muted">Round-robin by city or language.</p></li>
            <li><Link className="link" href="/products">4. Add products →</Link><p className="text-muted">Then send your first GST quotation.</p></li>
          </ol>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {m.finance ? (
          <>
            <Stat label="Invoiced this month" value={inrCompact(m.finance.invoicedMonth)} hint={`Collected ${inrCompact(m.finance.collectedMonth)}`} href="/invoices" />
            <Stat label="Outstanding receivables" value={inrCompact(m.finance.outstanding)} hint={m.finance.overdue ? `${inrCompact(m.finance.overdue)} overdue` : "Nothing overdue"} tone={m.finance.overdue ? "bad" : "good"} href="/invoices?tab=overdue" />
          </>
        ) : (
          <>
            <Stat label="Calls today" value={m.callsToday} hint={`${m.connectedToday} connected · ${m.talkMinutesToday} min talk`} href="/calls" />
            <Stat label="Follow-ups due today" value={m.fuDue} hint={m.fuOverdue ? `${m.fuOverdue} overdue` : "None overdue"} tone={m.fuOverdue ? "warn" : "good"} href="/followups" />
          </>
        )}
        <Stat label="New leads (7 days)" value={m.newLeads7} hint={`${m.conversionRate}% conversion this month`} href="/leads" />
        {m.finance ? <Stat label="Open pipeline" value={inrCompact(m.finance.pipelineOpen)} hint={`${m.callsToday} calls today`} href="/pipeline" />
          : <Stat label="Hot leads without follow-up" value={m.hotNoFollow} tone={m.hotNoFollow ? "warn" : "good"} hint="Call these first" href="/leads?band=hot&nofollow=1" />}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="AI Business Summary" className="lg:col-span-2"
          actions={has(ctx, "ai.use") && hasModule(ctx, "ai") ? <span className="text-xs text-muted">{aiEnabled() ? "AI briefing available" : "Rule-based (add ANTHROPIC_API_KEY for AI)"}</span> : null}>
          <ul className="space-y-2.5">
            {insights.map((i, k) => {
              const Icon = ICON[i.severity];
              return (
                <li key={k} className="flex items-start gap-2.5 text-sm">
                  <Icon size={16} className={`mt-0.5 shrink-0 ${TONE[i.severity]}`} aria-label={i.severity} />
                  <span className="flex-1">{i.text}</span>
                  {i.href && <Link href={i.href} className="link shrink-0 text-xs">View</Link>}
                </li>
              );
            })}
          </ul>
          {has(ctx, "ai.use") && hasModule(ctx, "ai") && aiEnabled() && <AiBriefing />}
        </Card>

        <Card title="My follow-ups (next 24h)" actions={<Link href="/followups" className="link text-xs">All</Link>} pad={false}>
          {myFollowups.length ? (
            <ul className="divide-y divide-line">
              {myFollowups.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Link href={f.leadId ? `/leads/${f.leadId}` : `/contacts/${f.contactId}`} className="truncate font-medium hover:underline">{f.lead?.name ?? f.contact?.name ?? "—"}</Link>
                    <div className="truncate text-xs text-muted">{f.note ?? f.type}</div>
                  </div>
                  <span className={`shrink-0 text-xs ${f.dueAt < new Date() ? "font-medium text-red-700" : "text-muted"}`}>{fmtDate(f.dueAt, true)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="Nothing due">You're all caught up.</Empty>}
        </Card>

        {m.finance && (
          <Card title="Invoiced revenue · last 6 months" className="lg:col-span-2">
            <BarChart label="Invoiced revenue by month" data={m.finance.monthly} format={(v) => inrCompact(v)} />
          </Card>
        )}

        <Card title="Leads by source · 30 days" className={m.finance ? "" : "lg:col-span-2"}>
          {m.bySource.length ? <HBars data={m.bySource.slice(0, 7).map((s) => ({ ...s, label: s.label.replace(/\b\w/g, (c) => c.toUpperCase()) }))} /> : <Empty title="No leads yet" />}
        </Card>

        {hotLeads.length > 0 && (
          <Card title="Top leads by score" pad={false} className={m.finance ? "lg:col-span-3" : ""}>
            <table className="table">
              <thead><tr><th>Lead</th><th>Score</th><th>Status</th><th className="hidden md:table-cell">Budget</th><th className="hidden md:table-cell">Next follow-up</th></tr></thead>
              <tbody>
                {hotLeads.map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.name}</Link><div className="text-xs text-muted">{l.companyName ?? l.city}</div></td>
                    <td><ScoreBadge score={l.score} band={l.scoreBand} /></td>
                    <td className="capitalize">{l.status}</td>
                    <td className="hidden tabular-nums md:table-cell">{l.budget ? inr(l.budget, false) : "—"}</td>
                    <td className="hidden md:table-cell">{l.nextFollowUpAt ? fmtDate(l.nextFollowUpAt, true) : <span className="text-amber-700">Not scheduled</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
