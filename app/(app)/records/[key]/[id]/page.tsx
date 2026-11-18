import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize, guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CustomFieldInputs, CustomFieldList } from "@/components/CustomFields";
import { parseCustom } from "@/lib/custom";
import { audit } from "@/lib/audit";
import { fmtDate, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

async function updateRecord(id: string, key: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("records.manage");
  const r = await ctx.db.customRecord.findFirstOrThrow({ where: { id } });
  const defs = await ctx.db.customFieldDef.findMany({ where: { entity: `obj:${key}` } });
  const data = parseCustom(defs, fd, (r.data ?? {}) as Record<string, unknown>);
  await ctx.db.customRecord.update({ where: { id }, data: { title: str(fd.get("title")) || r.title, data: data as object } });
  await audit(ctx, "record.update", `obj:${key}`, id, r.data, data);
  revalidatePath(`/records/${key}/${id}`);
});
}
async function deleteRecord(id: string, key: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("records.manage");
  await ctx.db.customRecord.delete({ where: { id } });
  await audit(ctx, "record.delete", `obj:${key}`, id);
  redirect(`/records/${key}`);
});
}

export default async function RecordPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const ctx = await guard("records.view", "custom");
  const obj = await ctx.db.customObject.findFirst({ where: { key } });
  const r = obj ? await ctx.db.customRecord.findFirst({ where: { id, objectId: obj.id, ...(await scopeWhere(ctx, "records.view", "ownerId", null)) } }) : null;
  if (!obj || !r) notFound();
  const [defs, contact] = await Promise.all([ctx.db.customFieldDef.findMany({ where: { entity: `obj:${key}` }, orderBy: { order: "asc" } }), r.contactId ? ctx.db.contact.findFirst({ where: { id: r.contactId } }) : null]);
  const data = (r.data ?? {}) as Record<string, unknown>;
  return (
    <>
      <PageHeader back={{ href: `/records/${key}`, label: obj.pluralName }} title={r.title} subtitle={<>{obj.name} #{r.number} · updated {fmtDate(r.updatedAt, true)}{contact && <> · <Link className="link" href={`/contacts/${contact.id}`}>{contact.name}</Link></>}</>}
        actions={has(ctx, "records.manage") && <form action={deleteRecord.bind(null, id, key)}><SubmitButton className="btn-ghost text-red-700" confirm="Delete this record?">Delete</SubmitButton></form>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details"><dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm"><CustomFieldList defs={defs} values={data} /></dl></Card>
        {has(ctx, "records.manage") && (
          <Card title="Edit">
            <form action={updateRecord.bind(null, id, key)} className="grid gap-3 md:grid-cols-2">
              <Field label="Title" className="md:col-span-2"><input name="title" defaultValue={r.title} className="input" /></Field>
              <CustomFieldInputs defs={defs} values={data} />
              <div className="md:col-span-2"><SubmitButton>Save</SubmitButton></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
