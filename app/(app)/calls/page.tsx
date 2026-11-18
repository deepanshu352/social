import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { guard, has, scopeWhere, phoneFor } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Empty, Pagination, Stat } from "@/components/ui";
import { DISPOSITIONS, dispositionLabel } from "@/lib/telephony";
import { fmtDate, fmtDuration, daysAgo } from "@/lib/utils";

export const metadata = { title: "Call logs" };
const PAGE = 30;

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await guard("call.view", "calling");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.CallLogWhereInput = { ...(await scopeWhere(ctx, "call.view", "agentId", null)) };
  if (sp.agent) where.agentId = sp.agent;
  if (sp.disposition) where.disposition = sp.disposition;
  const days = Number(sp.days) || 7;
  where.startedAt = { gte: daysAgo(days) };
  const [calls, total, agg, connected, members] = await Promise.all([
    ctx.db.callLog.findMany({ where, include: { agent: { include: { user: true } }, lead: true, contact: true }, orderBy: { startedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    ctx.db.callLog.count({ where }),
    ctx.db.callLog.aggregate({ where, _sum: { talkSeconds: true } }),
    ctx.db.callLog.count({ where: { ...where, talkSeconds: { gt: 0 } } }),
    ctx.perms["call.view"] !== "own" ? ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }) : [],
  ]);
  const talk = agg._sum.talkSeconds ?? 0;
  const qs = (p: Record<string, string>) => `/calls?${new URLSearchParams({ ...(sp as Record<string, string>), ...p })}`;
  return (
    <>
      <PageHeader title="Call logs" subtitle={`Last ${days} days`} actions={has(ctx, "call.make") ? <Link href="/dialer" className="btn-primary">Open dialer</Link> : null} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Calls" value={total} />
        <Stat label="Connected" value={connected} hint={total ? `${Math.round((connected / total) * 100)}% connection rate` : undefined} />
        <Stat label="Talk time" value={`${Math.round(talk / 60)} min`} />
        <Stat label="Avg handle time" value={connected ? fmtDuration(Math.round(talk / connected)) : "—"} />
      </div>
      <form className="mb-4 flex flex-wrap gap-2" action="/calls">
        <select name="days" defaultValue={String(days)} className="input w-auto"><option value="1">Today</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>
        {members.length > 0 && <select name="agent" defaultValue={sp.agent ?? ""} className="input w-auto"><option value="">All agents</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select>}
        <select name="disposition" defaultValue={sp.disposition ?? ""} className="input w-auto"><option value="">All outcomes</option>{DISPOSITIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card pad={false}>
        {calls.length ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>When</th><th>Customer</th><th>Agent</th><th>Status</th><th>Outcome</th><th>Talk</th><th className="hidden lg:table-cell">Notes</th></tr></thead>
            <tbody>{calls.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap">{fmtDate(c.startedAt, true)}</td>
                <td>{c.lead ? <Link className="hover:underline" href={`/leads/${c.lead.id}`}>{c.lead.name}</Link> : c.contact ? <Link className="hover:underline" href={`/contacts/${c.contact.id}`}>{c.contact.name}</Link> : "—"}<div className="text-xs text-muted">{phoneFor(ctx, c.toNumber)}</div></td>
                <td>{c.agent.user.name}</td>
                <td><StatusBadge status={c.status} /></td>
                <td>{dispositionLabel(c.disposition)}</td>
                <td className="tabular-nums">{fmtDuration(c.talkSeconds)}</td>
                <td className="hidden max-w-xs truncate text-muted lg:table-cell">{c.notes}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No calls in this period" />}
        <Pagination page={page} pages={Math.ceil(total / PAGE)} makeHref={(p) => qs({ page: String(p) })} />
      </Card>
    </>
  );
}
