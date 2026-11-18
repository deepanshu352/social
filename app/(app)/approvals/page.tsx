import Link from "next/link";
import { requireCtx, has } from "@/lib/auth";
import { canDecide } from "@/lib/approvals";
import { Card, PageHeader, Tabs, Badge, StatusBadge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { decideAction } from "./actions";
import { inr } from "@/lib/money";
import { fmtDate, timeAgo } from "@/lib/utils";

export const metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx();
  const { tab = "inbox" } = await searchParams;
  const pending = await ctx.db.approvalRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 300 });
  const inbox = [];
  for (const r of pending) if (await canDecide(ctx, r)) inbox.push(r);
  const rows = tab === "inbox" ? inbox : await ctx.db.approvalRequest.findMany({ where: tab === "mine" ? { requestedById: ctx.membership.id } : {}, orderBy: { createdAt: "desc" }, take: 100 });
  const quotes = has(ctx, "quotation.approve") ? await ctx.db.quotation.findMany({ where: { status: "pending_approval" }, include: { contact: true }, take: 50 }) : [];

  const ids = (e: string) => rows.filter((r) => r.entity === e).map((r) => r.entityId);
  const [expenses, leaves, pos, people] = await Promise.all([
    ctx.db.expense.findMany({ where: { id: { in: ids("expense") } } }),
    ctx.db.leaveRequest.findMany({ where: { id: { in: ids("leave") } } }),
    ctx.db.purchaseOrder.findMany({ where: { id: { in: ids("purchase_order") } }, include: { vendor: true } }),
    ctx.db.membership.findMany({ include: { user: true } }),
  ]);
  const name = (id: string) => people.find((p) => p.id === id)?.user.name ?? "—";

  return (
    <>
      <PageHeader title="Approvals" subtitle="Multi-level approvals for expenses, leave and purchase orders. You never approve your own requests." />
      <Tabs active={tab} items={[
        { key: "inbox", label: "Waiting for me", href: "/approvals", count: inbox.length + quotes.length },
        { key: "mine", label: "My requests", href: "/approvals?tab=mine" },
        ...(ctx.membership.role.key === "admin" ? [{ key: "all", label: "All", href: "/approvals?tab=all" }] : []),
      ]} />
      <div className="space-y-3">
        {tab === "inbox" && quotes.map((q) => (
          <Card key={q.id}><div className="flex flex-wrap items-center justify-between gap-3"><div><Badge tone="blue">Quotation discount</Badge> <span className="font-medium">{q.number}</span> · {q.contact.name} · {q.maxDiscountPct}% discount · {inr(q.total)}</div><Link href={`/quotations/${q.id}`} className="btn-secondary btn-sm">Review</Link></div></Card>
        ))}
        {rows.length === 0 && !(tab === "inbox" && quotes.length) && <Card><Empty title={tab === "inbox" ? "Nothing waiting for you 🎉" : "No requests"} /></Card>}
        {rows.map((r) => {
          const exp = expenses.find((x) => x.id === r.entityId), lv = leaves.find((x) => x.id === r.entityId), po = pos.find((x) => x.id === r.entityId);
          const history = (r.history as { level: number; by: string; decision: string; comment: string | null; at: string }[]) ?? [];
          return (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={r.entity === "expense" ? "amber" : r.entity === "leave" ? "violet" : "cyan"}>{r.entity.replace("_", " ")}</Badge><span className="font-medium">{r.title}</span><StatusBadge status={r.status === "approved" ? "accepted" : r.status} /></div>
                  <div className="mt-1 text-xs text-muted">Requested by {name(r.requestedById)} · {timeAgo(r.createdAt)} · level {Math.min(r.level + 1, r.levels.length)} of {r.levels.length} ({r.levels.join(" → ")})</div>
                  {exp && <div className="mt-2 text-sm">{exp.category} · {inr(exp.amount)} · {exp.vendorName ?? "—"} · {fmtDate(exp.expenseDate)} {exp.receiptId && <a className="link" href={`/api/files/${exp.receiptId}`} target="_blank">View receipt</a>}
                    {exp.flags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{exp.flags.map((f) => <Badge key={f} tone="amber">⚑ {f}</Badge>)}</div>}</div>}
                  {lv && <div className="mt-2 text-sm"><span className="capitalize">{lv.type}</span> leave · {fmtDate(lv.fromDate)} – {fmtDate(lv.toDate)} · {lv.days} day(s){lv.reason && <span className="normal-case text-muted"> · “{lv.reason}”</span>}</div>}
                  {po && <div className="mt-2 text-sm">{po.number} · {po.vendor.name} · {inr(po.total)} · <Link href="/purchases" className="link">details</Link></div>}
                  {history.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-muted">{history.map((h, i) => <li key={i}>L{h.level + 1}: {h.decision} by {h.by} {h.comment && `— “${h.comment}”`}</li>)}</ul>}
                </div>
                {tab === "inbox" && (
                  <form action={decideAction.bind(null, r.id)} className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <input name="comment" placeholder="Comment" className="input w-44" />
                    <SubmitButton name="decision" value="approve" className="btn-primary">Approve</SubmitButton>
                    <SubmitButton name="decision" value="reject" className="btn-danger">Reject</SubmitButton>
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
