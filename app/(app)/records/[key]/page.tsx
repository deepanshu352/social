import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authorize, guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, Empty, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CustomFieldInputs } from "@/components/CustomFields";
import { displayCustom, parseCustom } from "@/lib/custom";
import { nextNumber } from "@/lib/db";
import { audit } from "@/lib/audit";
import { str, timeAgo } from "@/lib/utils";
import { guarded } from "@/lib/action";

async function createRecord(objectId: string, key: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("records.manage", { mod: "custom" });
  const defs = await ctx.db.customFieldDef.findMany({ where: { entity: `obj:${key}` } });
  const title = str(fd.get("title"));
  if (!title) throw new Error("Title is required");
  const r = await ctx.db.customRecord.create({ data: { tenantId: ctx.tenant.id, objectId, number: await nextNumber(ctx.tenant.id, `obj:${key}`), title, data: parseCustom(defs, fd) as object, ownerId: ctx.membership.id, contactId: str(fd.get("contactId")) || null } });
  await audit(ctx, "record.create", `obj:${key}`, r.id, null, { title });
  redirect(`/records/${key}/${r.id}`);
});
}

export default async function Records({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ q?: string }> }) {
  const { key } = await params;
  const { q } = await searchParams;
  const ctx = await guard("records.view", "custom");
  const obj = await ctx.db.customObject.findFirst({ where: { key } });
  if (!obj) notFound();
  const [defs, records, contacts] = await Promise.all([
    ctx.db.customFieldDef.findMany({ where: { entity: `obj:${key}` }, orderBy: { order: "asc" } }),
    ctx.db.customRecord.findMany({ where: { objectId: obj.id, ...(await scopeWhere(ctx, "records.view", "ownerId", null)), ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { updatedAt: "desc" }, take: 300 }),
    ctx.db.contact.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  const cols = defs.filter((d) => d.showInList).slice(0, 6);
  return (
    <>
      <PageHeader title={obj.pluralName} subtitle={obj.description ?? undefined} actions={has(ctx, "settings.manage") && <Link href={`/settings/fields?e=obj:${key}`} className="btn-secondary">Manage fields</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card pad={false}>
          <form className="border-b border-line p-3" action={`/records/${key}`}><input name="q" defaultValue={q} placeholder={`Search ${obj.pluralName.toLowerCase()}…`} className="input max-w-xs" /></form>
          {records.length ? <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>{obj.name}</th>{cols.map((c) => <th key={c.id}>{c.label}</th>)}<th>Updated</th></tr></thead>
            <tbody>{records.map((r) => {
              const d = (r.data ?? {}) as Record<string, unknown>;
              return <tr key={r.id}><td><Link href={`/records/${key}/${r.id}`} className="font-medium hover:underline">{r.title}</Link><div className="text-xs text-muted">#{r.number}</div></td>
                {cols.map((c) => { const v = d[c.key]; const expired = c.type === "date" && v && new Date(String(v)) < new Date(); return <td key={c.id} className={expired ? "font-medium text-red-700" : ""}>{displayCustom(c, v)}</td>; })}
                <td className="text-xs text-muted">{timeAgo(r.updatedAt)}</td></tr>;
            })}</tbody>
          </table></div> : <Empty title={`No ${obj.pluralName.toLowerCase()} yet`} />}
        </Card>
        {has(ctx, "records.manage") && (
          <Card title={`New ${obj.name.toLowerCase()}`} className="h-fit">
            <form action={createRecord.bind(null, obj.id, key)} className="space-y-3">
              <Field label="Title / name *"><input name="title" required className="input" /></Field>
              <Field label="Linked customer"><select name="contactId" className="input"><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <div className="grid gap-3"><CustomFieldInputs defs={defs} /></div>
              <SubmitButton>Create</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
