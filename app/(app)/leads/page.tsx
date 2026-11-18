import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, ScoreBadge, StatusBadge, Empty, Tabs, Pagination } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { bulkAction } from "./actions";
import { fmtDate, timeAgo, titleCase } from "@/lib/utils";

export const metadata = { title: "Leads" };
const PAGE = 25;
const SOURCES = ["website", "google_ads", "facebook", "instagram", "whatsapp", "referral", "manual", "import", "api", "campaign", "phone", "landing_page"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await guard("lead.view", "crm");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.LeadWhereInput = { ...(await scopeWhere(ctx, "lead.view")), deletedAt: null };
  if (sp.status) where.status = sp.status as any;
  if (sp.source) where.source = sp.source as any;
  if (sp.band) where.scoreBand = sp.band;
  if (sp.owner === "unassigned") where.ownerId = null; else if (sp.owner) where.ownerId = sp.owner;
  if (sp.nofollow) where.nextFollowUpAt = null;
  if (sp.q) where.OR = [
    { name: { contains: sp.q, mode: "insensitive" } }, { companyName: { contains: sp.q, mode: "insensitive" } },
    { phone: { contains: sp.q } }, { email: { contains: sp.q, mode: "insensitive" } }, { city: { contains: sp.q, mode: "insensitive" } },
    ...(Number(sp.q.replace(/\D/g, "")) ? [{ number: Number(sp.q.replace(/\D/g, "")) }] : []),
  ];
  const base = { ...where }; delete (base as any).status;
  const [leads, total, counts, members] = await Promise.all([
    ctx.db.lead.findMany({ where, include: { owner: { include: { user: true } } }, orderBy: sp.sort === "score" ? { score: "desc" } : { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    ctx.db.lead.count({ where }),
    ctx.db.lead.groupBy({ by: ["status"], where: base, _count: true }),
    ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/leads?${p}`;
  };
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const all = counts.reduce((a, c) => a + c._count, 0);

  return (
    <>
      <PageHeader title="Leads" subtitle={`${total} lead${total === 1 ? "" : "s"}`} actions={<>
        {has(ctx, "lead.export") && <a href={`/api/leads/export?${new URLSearchParams(sp as Record<string, string>)}`} className="btn-secondary">Export CSV</a>}
        {has(ctx, "lead.import") && <Link href="/leads/import" className="btn-secondary">Import</Link>}
        {has(ctx, "lead.create") && <Link href="/leads/new" className="btn-primary">+ New lead</Link>}
      </>} />

      <Tabs active={sp.status ?? "all"} items={[
        { key: "all", label: "All", href: qs({ status: undefined, page: undefined }), count: all },
        ...["new", "contacted", "qualified", "converted", "lost"].map((s) => ({ key: s, label: titleCase(s), href: qs({ status: s, page: undefined }), count: count(s) })),
      ]} />

      <form className="mb-4 flex flex-wrap gap-2" action="/leads">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <input name="q" defaultValue={sp.q} placeholder="Search name, phone, company, LD-number…" className="input max-w-xs" />
        <select name="source" defaultValue={sp.source ?? ""} className="input w-auto"><option value="">All sources</option>{SOURCES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
        <select name="band" defaultValue={sp.band ?? ""} className="input w-auto"><option value="">Any score</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select>
        {ctx.perms["lead.view"] !== "own" && (
          <select name="owner" defaultValue={sp.owner ?? ""} className="input w-auto"><option value="">Any owner</option><option value="unassigned">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select>
        )}
        <select name="sort" defaultValue={sp.sort ?? ""} className="input w-auto"><option value="">Newest</option><option value="score">Highest score</option></select>
        <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" name="nofollow" value="1" defaultChecked={!!sp.nofollow} /> No follow-up</label>
        <button className="btn-secondary">Filter</button>
        {Object.keys(sp).length > 0 && <Link href="/leads" className="btn-ghost">Clear</Link>}
      </form>

      <form action={bulkAction}>
        <Card pad={false}>
          {leads.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th className="w-8"></th><th>Lead</th><th>Status</th><th>Score</th><th className="hidden lg:table-cell">Source</th><th className="hidden md:table-cell">Owner</th><th className="hidden lg:table-cell">Next follow-up</th><th className="hidden xl:table-cell">Last activity</th></tr></thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id}>
                      <td><input type="checkbox" name="ids" value={l.id} aria-label={`Select ${l.name}`} /></td>
                      <td>
                        <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.name}</Link>
                        <div className="text-xs text-muted">LD-{l.number}{l.companyName ? ` · ${l.companyName}` : ""}{l.city ? ` · ${l.city}` : ""}</div>
                      </td>
                      <td><StatusBadge status={l.status} /></td>
                      <td><ScoreBadge score={l.score} band={l.scoreBand} /></td>
                      <td className="hidden lg:table-cell">{titleCase(l.source)}</td>
                      <td className="hidden md:table-cell">{l.owner?.user.name ?? <span className="text-amber-700">Unassigned</span>}</td>
                      <td className="hidden lg:table-cell">{l.nextFollowUpAt ? <span className={l.nextFollowUpAt < new Date() ? "text-red-700" : ""}>{fmtDate(l.nextFollowUpAt, true)}</span> : <span className="text-muted">—</span>}</td>
                      <td className="hidden text-muted xl:table-cell">{timeAgo(l.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No leads match" action={has(ctx, "lead.create") ? <Link href="/leads/new" className="btn-primary">Add a lead</Link> : undefined}>Try clearing filters, or import leads from a CSV.</Empty>}
          {leads.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">With selected:</span>
              {has(ctx, "lead.assign") && (<>
                <select name="ownerId" className="input w-auto py-1.5 text-xs">{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select>
                <SubmitButton name="op" value="assign" className="btn-secondary btn-sm">Assign</SubmitButton>
              </>)}
              <input name="tag" placeholder="tag" className="input w-28 py-1.5 text-xs" />
              <SubmitButton name="op" value="tag" className="btn-secondary btn-sm">Add tag</SubmitButton>
              {has(ctx, "lead.delete") && <SubmitButton name="op" value="delete" className="btn-ghost btn-sm text-red-700" confirm="Delete selected leads?">Delete</SubmitButton>}
            </div>
          )}
          <Pagination page={page} pages={Math.ceil(total / PAGE)} makeHref={(p) => qs({ page: String(p) })} />
        </Card>
      </form>
    </>
  );
}
