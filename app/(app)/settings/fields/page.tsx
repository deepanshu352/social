import { revalidatePath } from "next/cache";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader, Badge, Field, Tabs } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { FIELD_TYPES, slugKey } from "@/lib/custom";
import { audit } from "@/lib/audit";
import { str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Custom fields" };
const BUILTIN: [string, string][] = [["lead", "Leads"], ["contact", "Customers"], ["task", "Tasks"]];

async function addField(entity: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("settings.manage", { mod: "custom" });
  const label = str(fd.get("label"));
  if (!label) throw new Error("Label is required");
  const type = str(fd.get("type"));
  if (!(FIELD_TYPES as readonly string[]).includes(type)) throw new Error("Invalid type");
  const options = str(fd.get("options")).split(",").map((s) => s.trim()).filter(Boolean);
  if (["select", "multiselect"].includes(type) && !options.length) throw new Error("Add options, comma separated");
  const count = await ctx.db.customFieldDef.count({ where: { entity } });
  if (count >= 40) throw new Error("Maximum 40 custom fields per record type");
  const f = await ctx.db.customFieldDef.create({ data: { tenantId: ctx.tenant.id, entity, key: slugKey(label), label, type, options, required: fd.get("required") === "on", showInList: fd.get("showInList") === "on", order: count } });
  await audit(ctx, "custom_field.create", "CustomFieldDef", f.id, null, { entity, label, type });
  revalidatePath("/settings/fields");
});
}
async function removeField(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("settings.manage");
  await ctx.db.customFieldDef.delete({ where: { id } });
  await audit(ctx, "custom_field.delete", "CustomFieldDef", id);
  revalidatePath("/settings/fields");
});
}

export default async function Fields({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const ctx = await guard("settings.manage", "custom");
  const objects = await ctx.db.customObject.findMany({ orderBy: { name: "asc" } });
  const entities: [string, string][] = [...BUILTIN, ...objects.map((o) => [`obj:${o.key}`, o.pluralName] as [string, string])];
  const e = (await searchParams).e ?? "lead";
  const defs = await ctx.db.customFieldDef.findMany({ where: { entity: e }, orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader title="Custom fields" subtitle="Add your own fields to leads, customers, tasks and custom objects — no code (BRD §64)." />
      <Tabs active={e} items={entities.map(([k, l]) => ({ key: k, label: l, href: `/settings/fields?e=${encodeURIComponent(k)}` }))} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card pad={false}>
          <table className="table"><thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Options</th><th></th></tr></thead>
            <tbody>{defs.map((d) => <tr key={d.id}><td className="font-medium">{d.label} {d.required && <Badge tone="red">required</Badge>} {d.showInList && <Badge tone="blue">in list</Badge>}</td><td className="font-mono text-xs">{d.key}</td><td>{d.type}</td><td className="max-w-xs truncate text-xs text-muted">{d.options.join(", ")}</td>
              <td><form action={removeField.bind(null, d.id)}><SubmitButton className="btn-ghost btn-sm text-red-700" confirm="Delete field? Existing values are kept in records but hidden.">Delete</SubmitButton></form></td></tr>)}
              {!defs.length && <tr><td colSpan={5} className="text-center text-sm text-muted">No custom fields yet.</td></tr>}</tbody></table>
        </Card>
        <Card title="Add field" className="h-fit">
          <form action={addField.bind(null, e)} className="space-y-3">
            <Field label="Label"><input name="label" required className="input" placeholder="e.g. GST registration type" /></Field>
            <Field label="Type"><select name="type" className="input">{FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Options (select types)" hint="Comma separated"><input name="options" className="input" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" /> Required</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showInList" /> Show as a column in lists</label>
            <SubmitButton>Add field</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
