import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { guard, has, scopeWhere, phoneFor } from "@/lib/auth";
import { Card, PageHeader, Empty, Pagination, Badge } from "@/components/ui";
import { inr } from "@/lib/money";
import { stateName } from "@/lib/india";

export const metadata = { title: "Customers" };
const PAGE = 30;

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await guard("contact.view", "crm");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ContactWhereInput = { ...(await scopeWhere(ctx, "contact.view")), deletedAt: null };
  if (sp.q) where.OR = [{ name: { contains: sp.q, mode: "insensitive" } }, { companyName: { contains: sp.q, mode: "insensitive" } }, { phone: { contains: sp.q } }, { email: { contains: sp.q, mode: "insensitive" } }, { gstin: { contains: sp.q, mode: "insensitive" } }];
  const [contacts, total] = await Promise.all([
    ctx.db.contact.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { owner: { include: { user: true } } } }),
    ctx.db.contact.count({ where }),
  ]);
  const sums = await ctx.db.invoice.groupBy({ by: ["contactId"], where: { contactId: { in: contacts.map((c) => c.id) }, status: { notIn: ["draft", "cancelled"] } }, _sum: { total: true, balance: true } });
  return (
    <>
      <PageHeader title="Customers" subtitle={`${total} customers`} actions={has(ctx, "contact.edit") && <Link href="/contacts/new" className="btn-primary">+ New customer</Link>} />
      <form className="mb-4 flex gap-2" action="/contacts"><input name="q" defaultValue={sp.q} placeholder="Search name, company, phone, GSTIN…" className="input max-w-sm" /><button className="btn-secondary">Search</button></form>
      <Card pad={false}>
        {contacts.length ? (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Customer</th><th>Phone</th><th className="hidden md:table-cell">State</th><th className="hidden lg:table-cell">Owner</th><th className="text-right">Lifetime value</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>{contacts.map((c) => {
              const s = sums.find((x) => x.contactId === c.id);
              return (
                <tr key={c.id}>
                  <td><Link href={`/contacts/${c.id}`} className="font-medium hover:underline">{c.name}</Link> {c.dnd && <Badge tone="red">DND</Badge>}<div className="text-xs text-muted">{c.companyName}{c.gstin && ` · ${c.gstin}`}</div></td>
                  <td>{phoneFor(ctx, c.phone) ?? "—"}</td>
                  <td className="hidden md:table-cell">{stateName(c.stateCode)}</td>
                  <td className="hidden lg:table-cell">{c.owner?.user.name ?? "—"}</td>
                  <td className="text-right tabular-nums">{inr(s?._sum.total ?? 0, false)}</td>
                  <td className={`text-right tabular-nums ${Number(s?._sum.balance ?? 0) > 0 ? "text-red-700" : "text-muted"}`}>{inr(s?._sum.balance ?? 0, false)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty title="No customers yet">Customers are created when you convert a lead, or add them directly.</Empty>}
        <Pagination page={page} pages={Math.ceil(total / PAGE)} makeHref={(p) => `/contacts?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) })}`} />
      </Card>
    </>
  );
}
