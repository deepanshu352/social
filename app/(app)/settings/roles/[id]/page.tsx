import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { PERMISSION_GROUPS, SCOPES, type PermissionMap, type Scope } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { str } from "@/lib/utils";
import { guarded } from "@/lib/action";

async function saveRole(id: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("user.manage");
  const role = await ctx.db.role.findFirstOrThrow({ where: { id } });
  if (role.key === "admin") throw new Error("The Company Admin role always has full access");
  const perms: PermissionMap = {};
  for (const g of PERMISSION_GROUPS) for (const p of g.perms) {
    const v = str(fd.get(p.key));
    if (SCOPES.includes(v as Scope)) perms[p.key] = v as Scope;
  }
  await ctx.db.role.update({ where: { id }, data: { name: str(fd.get("name")) || role.name, permissions: perms, maxDiscount: Math.max(0, Math.min(100, Number(fd.get("maxDiscount")) || 0)) } });
  await audit(ctx, "role.update", "Role", id, role.permissions, perms);
  revalidatePath(`/settings/roles/${id}`);
});
}

async function deleteRole(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("user.manage");
  const role = await ctx.db.role.findFirstOrThrow({ where: { id }, include: { _count: { select: { memberships: true } } } });
  if (role.isSystem || role._count.memberships) throw new Error("Only unused custom roles can be deleted");
  await prisma.role.delete({ where: { id: role.id } });
  await audit(ctx, "role.delete", "Role", id);
  revalidatePath("/settings/roles");
});
}

export default async function RoleEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("user.manage");
  const role = await ctx.db.role.findFirst({ where: { id } });
  if (!role) notFound();
  const perms = role.permissions as PermissionMap;
  const locked = role.key === "admin";
  return (
    <>
      <PageHeader title={role.name} back={{ href: "/settings/roles", label: "Roles" }} subtitle={locked ? "Company Admin always has full access and cannot be edited." : "Changes apply on the users' next request."} />
      <form action={saveRole.bind(null, id)} className="space-y-4">
        <Card>
          <div className="flex flex-wrap gap-4">
            <label><span className="label">Role name</span><input name="name" defaultValue={role.name} disabled={locked} className="input w-64" /></label>
            <label><span className="label">Max discount without approval (%)</span><input name="maxDiscount" type="number" min={0} max={100} defaultValue={role.maxDiscount} disabled={locked} className="input w-32" /></label>
          </div>
        </Card>
        {PERMISSION_GROUPS.map((g) => (
          <Card key={g.module} title={g.module} pad={false}>
            <table className="table">
              <tbody>{g.perms.map((p) => (
                <tr key={p.key}>
                  <td className="w-1/2">{p.label}<div className="text-xs text-muted"><code>{p.key}</code></div></td>
                  <td>
                    <select name={p.key} defaultValue={perms[p.key] ?? ""} disabled={locked} className="input w-48 py-1.5">
                      <option value="">No access</option>
                      {p.scoped ? SCOPES.map((s) => <option key={s} value={s}>{s === "own" ? "Own records" : s === "team" ? "My team" : s === "branch" ? "My branch" : "Entire company"}</option>) : <option value="all">Allowed</option>}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
        ))}
        {!locked && <div className="flex gap-2"><SubmitButton>Save role</SubmitButton>{!role.isSystem && <SubmitButton formAction={deleteRole.bind(null, id)} className="btn-ghost text-red-700" confirm="Delete this role?">Delete role</SubmitButton>}</div>}
      </form>
    </>
  );
}
