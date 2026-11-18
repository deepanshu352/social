import Link from "next/link";
import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Stat, Badge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ExpenseForm } from "./ExpenseForm";
import { reimburse } from "./actions";
import { inr, inrCompact } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Expenses" };

export default async function Expenses({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const ctx = await guard("hr.self", "hr");
  const { who } = await searchParams;
  const team = who === "team" && has(ctx, "expense.view") && ctx.perms["expense.view"] !== "own";
  const where = team ? await scopeWhere(ctx, "expense.view", "membershipId", null) : { membershipId: ctx.membership.id };
  const [rows, pending, approved, paid] = await Promise.all([
    ctx.db.expense.findMany({ where, include: { membership: { include: { user: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    ctx.db.expense.aggregate({ where: { ...where, status: "submitted" }, _sum: { amount: true }, _count: true }),
    ctx.db.expense.aggregate({ where: { ...where, status: "approved" }, _sum: { amount: true }, _count: true }),
    ctx.db.expense.aggregate({ where: { ...where, status: "reimbursed", reimbursedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }, _sum: { amount: true } }),
  ]);
  return (
    <>
      <PageHeader title="Expenses" subtitle="Snap a bill → AI fills the claim → manager & accounts approve → reimbursed."
        actions={has(ctx, "expense.view") && ctx.perms["expense.view"] !== "own" && <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm"><Link href="/expenses" className={`rounded-md px-3 py-1 ${!team ? "bg-gray-100 font-medium" : ""}`}>Mine</Link><Link href="/expenses?who=team" className={`rounded-md px-3 py-1 ${team ? "bg-gray-100 font-medium" : ""}`}>Team</Link></div>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Awaiting approval" value={inrCompact(pending._sum.amount)} hint={`${pending._count} claims`} href="/approvals" />
        <Stat label="Approved, to be paid" value={inrCompact(approved._sum.amount)} hint={`${approved._count} claims`} />
        <Stat label="Reimbursed this month" value={inrCompact(paid._sum.amount)} tone="good" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card pad={false}>
          {rows.length ? <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Claim</th>{team && <th>Employee</th>}<th>Category</th><th>Date</th><th className="text-right">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}>
                <td><div className="font-medium">EXP-{e.number}</div><div className="max-w-56 truncate text-xs text-muted">{e.vendorName}{e.description && ` · ${e.description}`}</div>
                  {e.flags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{e.flags.map((f) => <Badge key={f} tone="amber">⚑ {f}</Badge>)}</div>}</td>
                {team && <td>{e.membership.user.name}</td>}
                <td>{e.category}</td><td className="text-xs">{fmtDate(e.expenseDate)}</td><td className="text-right tabular-nums">{inr(e.amount)}</td>
                <td><StatusBadge status={e.status === "submitted" ? "pending" : e.status === "reimbursed" ? "paid" : e.status} /></td>
                <td className="whitespace-nowrap">{e.receiptId && <a href={`/api/files/${e.receiptId}`} target="_blank" className="link text-xs">Receipt</a>}
                  {e.status === "approved" && has(ctx, "expense.reimburse") && <form action={reimburse.bind(null, e.id)} className="mt-1"><SubmitButton className="btn-secondary btn-sm">Mark paid</SubmitButton></form>}</td>
              </tr>
            ))}</tbody>
          </table></div> : <Empty title="No expense claims yet" />}
        </Card>
        <Card title="New claim" className="h-fit"><ExpenseForm /></Card>
      </div>
    </>
  );
}
