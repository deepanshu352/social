import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Empty, Tabs } from "@/components/ui";
import { inr } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Quotations" };
const TABS = [["all", "All"], ["draft", "Draft"], ["pending_approval", "Needs approval"], ["sent", "Sent"], ["accepted", "Accepted"], ["converted", "Invoiced"]] as const;

export default async function Quotations({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await guard("quotation.view", "quotations");
  const { status = "all" } = await searchParams;
  const base: Prisma.QuotationWhereInput = await scopeWhere(ctx, "quotation.view");
  const where: Prisma.QuotationWhereInput = { ...base, ...(status === "all" ? {} : status === "sent" ? { status: { in: ["sent", "viewed"] } } : { status: status as any }) };
  const [rows, counts] = await Promise.all([
    ctx.db.quotation.findMany({ where, include: { contact: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    ctx.db.quotation.groupBy({ by: ["status"], where: base, _count: true }),
  ]);
  const c = (s: string) => counts.filter((x) => (s === "sent" ? ["sent", "viewed"].includes(x.status) : x.status === s)).reduce((a, x) => a + x._count, 0);
  return (
    <>
      <PageHeader title="Quotations" actions={has(ctx, "quotation.create") && <Link href="/quotations/new" className="btn-primary">+ New quotation</Link>} />
      <Tabs active={status} items={TABS.map(([k, l]) => ({ key: k, label: l, href: `/quotations?status=${k}`, count: k === "all" ? undefined : c(k) }))} />
      <Card pad={false}>
        {rows.length ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Valid until</th><th>Status</th><th className="text-right">Views</th><th className="text-right">Total</th></tr></thead>
            <tbody>{rows.map((q) => (
              <tr key={q.id}>
                <td><Link href={`/quotations/${q.id}`} className="font-medium hover:underline">{q.number}</Link></td>
                <td>{q.contact.name}</td><td>{fmtDate(q.issueDate)}</td>
                <td className={q.validUntil < new Date() && !["accepted", "converted"].includes(q.status) ? "text-red-700" : ""}>{fmtDate(q.validUntil)}</td>
                <td><StatusBadge status={q.status} /></td>
                <td className="text-right tabular-nums">{q.viewCount}</td>
                <td className="text-right tabular-nums">{inr(q.total)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No quotations" action={has(ctx, "quotation.create") ? <Link href="/quotations/new" className="btn-primary">Create quotation</Link> : undefined} />}
      </Card>
    </>
  );
}
