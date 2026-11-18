import { revalidatePath } from "next/cache";
import { authorize, guard, has, hasModule } from "@/lib/auth";
import { Card, PageHeader, Badge, Field, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { AskKb } from "./Ask";
import { aiEnabled, kbSearch } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { fmtDate, optStr, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Knowledge base" };

async function saveDoc(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("kb.manage");
  const id = optStr(fd.get("id"));
  const file = fd.get("file");
  let content = str(fd.get("content"));
  if (file instanceof File && file.size) {
    if (file.size > 1024 * 1024) throw new Error("Text files up to 1 MB");
    if (!/\.(txt|md|csv)$/i.test(file.name)) throw new Error("Upload .txt, .md or .csv (paste other documents as text)");
    content = (await file.text()).slice(0, 200_000);
  }
  const data = { title: str(fd.get("title")), category: str(fd.get("category")) || "General", content, visibleToRoles: fd.getAll("roles").map(String) };
  if (!data.title || !data.content) throw new Error("Title and content are required");
  if (id) await ctx.db.knowledgeDoc.update({ where: { id }, data });
  else await ctx.db.knowledgeDoc.create({ data: { ...data, tenantId: ctx.tenant.id, createdById: ctx.membership.id } });
  await audit(ctx, id ? "kb.update" : "kb.create", "KnowledgeDoc", id, null, { title: data.title, roles: data.visibleToRoles });
  revalidatePath("/knowledge");
});
}
async function deleteDoc(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("kb.manage");
  await ctx.db.knowledgeDoc.delete({ where: { id } });
  await audit(ctx, "kb.delete", "KnowledgeDoc", id);
  revalidatePath("/knowledge");
});
}

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ q?: string; doc?: string; edit?: string }> }) {
  const ctx = await guard("kb.view");
  const sp = await searchParams;
  const role = ctx.membership.role.key;
  const visible = { OR: [{ visibleToRoles: { isEmpty: true } }, { visibleToRoles: { has: role } }] };
  const [docs, roles] = await Promise.all([ctx.db.knowledgeDoc.findMany({ where: visible, orderBy: [{ category: "asc" }, { title: "asc" }] }), ctx.db.role.findMany()]);
  const hits = sp.q ? await kbSearch(ctx.tenant.id, role, sp.q) : null;
  const open = docs.find((d) => d.id === sp.doc);
  const edit = has(ctx, "kb.manage") ? docs.find((d) => d.id === sp.edit) : undefined;
  return (
    <>
      <PageHeader title="Knowledge base" subtitle="SOPs, policies, price rules and manuals. The AI Copilot answers only from documents your role can see." />
      {aiEnabled() && hasModule(ctx, "ai") && <div className="mb-6"><AskKb /></div>}
      <div className="grid gap-6 xl:grid-cols-[300px_1fr_360px]">
        <Card title={`Documents (${docs.length})`} pad={false} className="h-fit">
          <form action="/knowledge" className="border-b border-line p-3"><input name="q" defaultValue={sp.q} placeholder="Search…" className="input" /></form>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {(hits ? docs.filter((d) => hits.some((h) => h.id === d.id)) : docs).map((d) => (
              <li key={d.id}><a href={`/knowledge?doc=${d.id}`} className={`block px-4 py-2.5 text-sm hover:bg-gray-50 ${d.id === sp.doc ? "bg-brand-50" : ""}`}><div className="font-medium">{d.title}</div><div className="text-xs text-muted">{d.category}{d.visibleToRoles.length ? ` · ${d.visibleToRoles.length} role(s)` : " · everyone"}</div></a></li>
            ))}
          </ul>
        </Card>
        <div>
          {hits && <Card title={`Search: “${sp.q}”`} className="mb-4">{hits.length ? <ul className="space-y-3 text-sm">{hits.map((h) => <li key={h.id}><a href={`/knowledge?doc=${h.id}`} className="link font-medium">{h.title}</a><p className="text-muted">…{h.snippet}…</p></li>)}</ul> : <p className="text-sm text-muted">No matches.</p>}</Card>}
          {open ? (
            <Card title={open.title} actions={has(ctx, "kb.manage") && <div className="flex gap-1"><a href={`/knowledge?edit=${open.id}`} className="btn-ghost btn-sm">Edit</a><form action={deleteDoc.bind(null, open.id)}><SubmitButton className="btn-ghost btn-sm text-red-700" confirm="Delete document?">Delete</SubmitButton></form></div>}>
              <div className="mb-3 flex gap-2 text-xs"><Badge>{open.category}</Badge><span className="text-muted">Updated {fmtDate(open.updatedAt)}</span></div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{open.content}</div>
            </Card>
          ) : !hits && <Card><Empty title="Select a document">Or ask the AI a question above.</Empty></Card>}
        </div>
        {has(ctx, "kb.manage") && (
          <Card title={edit ? "Edit document" : "Add document"} className="h-fit">
            <form action={saveDoc} key={edit?.id ?? "new"} className="space-y-3">
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <Field label="Title"><input name="title" required defaultValue={edit?.title} className="input" /></Field>
              <Field label="Category"><input name="category" defaultValue={edit?.category ?? "General"} list="kbcats" className="input" /><datalist id="kbcats">{["HR", "Sales", "Finance", "Product", "Operations", "Support"].map((c) => <option key={c} value={c} />)}</datalist></Field>
              <Field label="Content"><textarea name="content" rows={8} defaultValue={edit?.content} className="input text-sm" /></Field>
              <Field label="…or upload .txt / .md"><input type="file" name="file" accept=".txt,.md,.csv" className="input" /></Field>
              <div><span className="label">Visible to (none = everyone)</span><div className="flex flex-wrap gap-x-3 gap-y-1">{roles.map((r) => <label key={r.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="roles" value={r.key} defaultChecked={edit?.visibleToRoles.includes(r.key)} />{r.name}</label>)}</div></div>
              <SubmitButton>{edit ? "Save" : "Add document"}</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
