import Link from "next/link";
import { revalidatePath } from "next/cache";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader, Badge, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { PACKS, applyPack } from "@/lib/industry";
import { prisma } from "@/lib/prisma";
import { slugKey } from "@/lib/custom";
import { audit } from "@/lib/audit";
import { str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Custom objects & industry packs" };

async function createObject(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("settings.manage", { mod: "custom" });
  const name = str(fd.get("name"));
  if (!name) throw new Error("Name is required");
  if ((await ctx.db.customObject.count()) >= 25) throw new Error("Maximum 25 custom objects");
  const o = await ctx.db.customObject.create({ data: { tenantId: ctx.tenant.id, key: slugKey(name), name, pluralName: str(fd.get("plural")) || `${name}s`, description: str(fd.get("description")) || null } });
  await audit(ctx, "custom_object.create", "CustomObject", o.id, null, { name });
  revalidatePath("/settings/objects");
});
}
async function installPack(key: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("settings.manage", { mod: "custom" });
  const pack = await applyPack(prisma, ctx.tenant.id, key);
  await audit(ctx, "industry_pack.apply", "Tenant", ctx.tenant.id, null, { pack: pack.name });
  revalidatePath("/", "layout");
});
}

export default async function Objects() {
  const ctx = await guard("settings.manage", "custom");
  const objects = await ctx.db.customObject.findMany({ include: { _count: { select: { records: true } } }, orderBy: { name: "asc" } });
  const have = new Set(objects.map((o) => o.key));
  return (
    <>
      <PageHeader title="Custom objects & industry packs" subtitle="Track anything — vehicles, properties, patients, students, machines — with its own fields, list and records (BRD §65)." />
      <Card title="Industry packs" className="mb-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PACKS.map((p) => {
            const installed = p.objects.length ? p.objects.every((o) => have.has(o.key)) : false;
            return (
              <div key={p.key} className="flex flex-col rounded-xl border border-line p-4">
                <div className="flex items-center justify-between font-medium">{p.name}{installed && <Badge tone="green">Installed</Badge>}</div>
                <p className="mt-1 flex-1 text-xs text-muted">{p.description}</p>
                <div className="mt-2 text-xs">{p.objects.map((o) => o.plural).join(" · ") || "Custom fields only"}</div>
                <form action={installPack.bind(null, p.key)} className="mt-3"><SubmitButton className={installed ? "btn-secondary btn-sm w-full" : "btn-primary btn-sm w-full"}>{installed ? "Re-apply (adds missing)" : "Install pack"}</SubmitButton></form>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card title="Your objects" pad={false}>
          <table className="table"><thead><tr><th>Object</th><th>Records</th><th></th></tr></thead>
            <tbody>{objects.map((o) => <tr key={o.id}><td><div className="font-medium">{o.pluralName}</div><div className="text-xs text-muted">{o.description}</div></td><td>{o._count.records}</td>
              <td className="whitespace-nowrap text-right"><Link href={`/records/${o.key}`} className="link text-xs">Open</Link> · <Link href={`/settings/fields?e=obj:${o.key}`} className="link text-xs">Fields</Link></td></tr>)}
              {!objects.length && <tr><td colSpan={3} className="text-center text-sm text-muted">No custom objects yet — install a pack or create one.</td></tr>}</tbody></table>
        </Card>
        <Card title="Create object" className="h-fit">
          <form action={createObject} className="space-y-3">
            <Field label="Name (singular)"><input name="name" required className="input" placeholder="Machine" /></Field>
            <Field label="Plural"><input name="plural" className="input" placeholder="Machines" /></Field>
            <Field label="Description"><input name="description" className="input" /></Field>
            <SubmitButton>Create object</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
