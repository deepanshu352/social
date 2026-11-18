import type { Prisma } from "@prisma/client";
import { guard } from "@/lib/auth";
import { Card, PageHeader, Badge, Pagination } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Audit log" };
const PAGE = 50;

function diff(before: unknown, after: unknown) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return after ? JSON.stringify(after).slice(0, 160) : "";
  const b = before as Record<string, unknown>, a = after as Record<string, unknown>;
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(b[k]) ?? "—"} → ${JSON.stringify(a[k])}`).join("; ").slice(0, 240);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; type?: string }> }) {
  const ctx = await guard("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.q ? { OR: [{ action: { contains: sp.q, mode: "insensitive" } }, { actorName: { contains: sp.q, mode: "insensitive" } }, { entity: { contains: sp.q, mode: "insensitive" } }] } : {}),
    ...(sp.type ? { actorType: sp.type } : {}),
  };
  const [rows, total] = await Promise.all([ctx.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }), ctx.db.auditLog.count({ where })]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of who changed what, and when." />
      <form className="mb-4 flex gap-2" action="/settings/audit">
        <input name="q" defaultValue={sp.q} placeholder="Filter action, user, entity" className="input max-w-xs" />
        <select name="type" defaultValue={sp.type ?? ""} className="input w-auto"><option value="">All actors</option><option value="user">Users</option><option value="ai">AI</option><option value="api_key">API keys</option><option value="system">System</option><option value="platform">Platform admin</option></select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card pad={false}>
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Change</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs">{fmtDate(r.createdAt, true)}</td>
              <td>{r.actorName} {r.actorType !== "user" && <Badge tone={r.actorType === "ai" ? "amber" : "violet"}>{r.actorType}</Badge>}</td>
              <td><code className="text-xs">{r.action}</code></td>
              <td className="text-xs">{r.entity}{r.entityId && <span className="text-muted"> · {r.entityId.slice(-6)}</span>}</td>
              <td className="max-w-md truncate text-xs text-muted" title={diff(r.before, r.after)}>{diff(r.before, r.after)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <Pagination page={page} pages={Math.ceil(total / PAGE)} makeHref={(p) => `/settings/audit?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) })}`} />
      </Card>
    </>
  );
}
