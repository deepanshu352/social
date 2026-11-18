import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Empty, Tabs, Stat } from "@/components/ui";
import { inr, inrCompact, toNum } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Invoices" };

export default async function Invoices({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await guard("invoice.view", "invoices");
  const { tab = "all", q } = await searchParams;
  const now = new Date();
  const base: Prisma.InvoiceWhereInput = { ...(await scopeWhere(ctx, "invoice.view")), ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { contact: { name: { contains: q, mode: "insensitive" } } }] } : {}) };
  const open = { status: { in: ["issued", "partially_paid", "overdue"] as any } };
  const filters: Record<string, Prisma.InvoiceWhereInput> = {
    all: {}, draft: { status: "draft" }, unpaid: { ...open, dueDate: { gte: now } }, overdue: { ...open, dueDate: { lt: now } }, paid: { status: "paid" }, cancelled: { status: "cancelled" },
  };
  const [rows, outstanding, overdue, aging] = await Promise.all([
    ctx.db.invoice.findMany({ where: { ...base, ...filters[tab] }, include: { contact: true }, orderBy: [{ issueDate: "desc" }], take: 200 }),
    ctx.db.invoice.aggregate({ where: { ...base, ...open }, _sum: { balance: true }, _count: true }),
    ctx.db.invoice.aggregate({ where: { ...base, ...open, dueDate: { lt: now } }, _sum: { balance: true }, _count: true }),
    ctx.db.invoice.findMany({ where: { ...base, ...open, dueDate: { lt: now } }, select: { dueDate: true, balance: true } }),
  ]);
  const bucket = (lo: number, hi: number) => aging.filter((i) => { const d = (now.getTime() - i.dueDate.getTime()) / 86400_000; return d > lo && d <= hi; }).reduce((a, i) => a + toNum(i.balance), 0);
  return (
    <>
      <PageHeader title="Invoices" actions={has(ctx, "invoice.create") && <Link href="/invoices/new" className="btn-primary">+ New invoice</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Outstanding" value={inrCompact(outstanding._sum.balance)} hint={`${outstanding._count} open invoices`} />
        <Stat label="Overdue" value={inrCompact(overdue._sum.balance)} hint={`${overdue._count} invoices`} tone={overdue._count ? "bad" : "good"} />
        <Stat label="1–30 days late" value={inrCompact(bucket(0, 30))} />
        <Stat label="31–60 days late" value={inrCompact(bucket(30, 60))} />
        <Stat label="60+ days late" value={inrCompact(bucket(60, 1e6))} tone={bucket(60, 1e6) ? "bad" : undefined} />
      </div>
      <Tabs active={tab} items={["all", "draft", "unpaid", "overdue", "paid", "cancelled"].map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), href: `/invoices?tab=${k}` }))} />
      <form action="/invoices" className="mb-4"><input type="hidden" name="tab" value={tab} /><input name="q" defaultValue={q} placeholder="Search number or customer" className="input max-w-xs" /></form>
      <Card pad={false}>
        {rows.length ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Due</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr></thead>
            <tbody>{rows.map((i) => {
              const late = ["issued", "partially_paid", "overdue"].includes(i.status) && i.dueDate < now;
              return (
                <tr key={i.id}>
                  <td><Link href={`/invoices/${i.id}`} className="font-medium hover:underline">{i.number ?? "Draft"}</Link></td>
                  <td>{i.contact.name}</td><td>{fmtDate(i.issueDate)}</td>
                  <td className={late ? "font-medium text-red-700" : ""}>{fmtDate(i.dueDate)}{late && ` · ${Math.floor((now.getTime() - i.dueDate.getTime()) / 86400_000)}d`}</td>
                  <td><StatusBadge status={late ? "overdue" : i.status} /></td>
                  <td className="text-right tabular-nums">{inr(i.total)}</td><td className="text-right tabular-nums">{inr(i.balance)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty title="No invoices here" />}
      </Card>
    </>
  );
}
