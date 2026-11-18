import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { audit } from "@/lib/audit";
import { str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Roles" };

async function cloneRole(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("user.manage");
  const src = await ctx.db.role.findFirstOrThrow({ where: { id: str(fd.get("from")) } });
  const name = str(fd.get("name")) || `${src.name} (copy)`;
  const r = await ctx.db.role.create({ data: { tenantId: ctx.tenant.id, name, key: `custom_${Date.now().toString(36)}`, permissions: src.permissions ?? {}, maxDiscount: src.maxDiscount } });
  await audit(ctx, "role.create", "Role", r.id, null, { name, from: src.name });
  revalidatePath("/settings/roles");
  redirect(`/settings/roles/${r.id}`);
});
}

export default async function Roles() {
  const ctx = await guard("user.manage");
  const roles = await ctx.db.role.findMany({ include: { _count: { select: { memberships: true } } }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Each permission has a scope: own records, team, branch or the whole company." />
      <Card pad={false} className="mb-6">
        <table className="table">
          <thead><tr><th>Role</th><th>Users</th><th>Permissions</th><th>Discount limit</th><th></th></tr></thead>
          <tbody>{roles.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{r.name} {r.isSystem && <Badge>System</Badge>}</td>
              <td>{r._count.memberships}</td>
              <td>{Object.keys(r.permissions as object).length}</td>
              <td>{r.maxDiscount}%</td>
              <td><Link href={`/settings/roles/${r.id}`} className="link text-xs">Edit</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="Create custom role">
        <form action={cloneRole} className="flex flex-wrap gap-2">
          <input name="name" placeholder="Role name, e.g. Field Technician" required className="input max-w-xs" />
          <select name="from" className="input w-auto">{roles.map((r) => <option key={r.id} value={r.id}>Start from: {r.name}</option>)}</select>
          <SubmitButton>Create</SubmitButton>
        </form>
      </Card>
    </>
  );
}
