import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader, Field, StatusBadge, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { planByKey } from "@/lib/plans";
import { optStr, randomToken, str, timeAgo } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Users" };

async function invite(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("user.manage");
  const email = str(fd.get("email")).toLowerCase();
  const seatsUsed = await ctx.db.membership.count({ where: { status: "active" } });
  if (seatsUsed >= Math.min(ctx.tenant.seats, planByKey(ctx.tenant.plan).limits.users) && ctx.tenant.status === "active") throw new Error("No free seats. Add seats in Plan & billing.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Valid email required");
  let user = await prisma.user.findUnique({ where: { email } });
  let tempPassword: string | null = null;
  if (!user) {
    tempPassword = randomToken(9);
    user = await prisma.user.create({ data: { email, name: str(fd.get("name")) || email.split("@")[0], passwordHash: await bcrypt.hash(tempPassword, 10) } });
  }
  const exists = await ctx.db.membership.findFirst({ where: { userId: user.id } });
  if (exists) throw new Error("This user is already in your company");
  const role = await ctx.db.role.findFirst({ where: { id: str(fd.get("roleId")) } });
  if (!role) throw new Error("Pick a role");
  if (role.key === "admin" && ctx.membership.role.key !== "admin") throw new Error("Only admins can create admins");
  const m = await ctx.db.membership.create({
    data: { tenantId: ctx.tenant.id, userId: user.id, roleId: role.id, branchId: optStr(fd.get("branchId")), teamId: optStr(fd.get("teamId")), managerId: optStr(fd.get("managerId")), title: optStr(fd.get("title")), languages: str(fd.get("languages")).split(",").map((s) => s.trim()).filter(Boolean) },
  });
  await audit(ctx, "user.invite", "Membership", m.id, null, { email, role: role.name });
  // Integration point: email the invite. For now the admin shares the temporary password.
  revalidatePath("/settings/users");
  if (tempPassword) await ctx.db.notification.create({ data: { tenantId: ctx.tenant.id, membershipId: ctx.membership.id, title: `Temporary password for ${email}`, body: `${tempPassword} — share it securely; they should change it after first login.` } });
});
}

async function update(id: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("user.manage");
  if (id === ctx.membership.id && str(fd.get("status")) === "disabled") throw new Error("You cannot disable yourself");
  const before = await ctx.db.membership.findFirstOrThrow({ where: { id } });
  const data = {
    roleId: str(fd.get("roleId")) || before.roleId, branchId: optStr(fd.get("branchId")), teamId: optStr(fd.get("teamId")), managerId: optStr(fd.get("managerId")),
    status: (str(fd.get("status")) || before.status) as "active" | "disabled", isAvailable: fd.get("isAvailable") === "on",
  };
  await ctx.db.membership.update({ where: { id }, data });
  if (data.status === "disabled") await prisma.session.updateMany({ where: { userId: before.userId, tenantId: ctx.tenant.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(ctx, "user.update", "Membership", id, before, data);
  revalidatePath("/settings/users");
});
}

export default async function Users() {
  const ctx = await guard("user.manage");
  const [members, roles, branches, teams] = await Promise.all([
    ctx.db.membership.findMany({ include: { user: true, role: true, branch: true, team: true }, orderBy: { createdAt: "asc" } }),
    ctx.db.role.findMany({ orderBy: { createdAt: "asc" } }), ctx.db.branch.findMany(), ctx.db.team.findMany(),
  ]);
  const active = members.filter((m) => m.status === "active").length;
  return (
    <>
      <PageHeader title="Users" subtitle={`${active} active of ${ctx.tenant.seats} seats`} />
      <div className="space-y-6">
        <Card pad={false}>
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>User</th><th>Role</th><th>Branch</th><th>Team</th><th>Reports to</th><th>Available</th><th>Status</th><th></th></tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.id}>
                <td><div className="font-medium">{m.user.name} {m.user.totpEnabled && <Badge tone="green">2FA</Badge>}</div><div className="text-xs text-muted">{m.user.email} · last login {timeAgo(m.user.lastLoginAt)}</div></td>
                <td colSpan={7} className="p-0">
                  <form action={update.bind(null, m.id)} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <select name="roleId" defaultValue={m.roleId} className="input w-40 py-1.5 text-xs">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                    <select name="branchId" defaultValue={m.branchId ?? ""} className="input w-32 py-1.5 text-xs"><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                    <select name="teamId" defaultValue={m.teamId ?? ""} className="input w-32 py-1.5 text-xs"><option value="">—</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                    <select name="managerId" defaultValue={m.managerId ?? ""} className="input w-36 py-1.5 text-xs"><option value="">—</option>{members.filter((x) => x.id !== m.id).map((x) => <option key={x.id} value={x.id}>{x.user.name}</option>)}</select>
                    <input type="checkbox" name="isAvailable" defaultChecked={m.isAvailable} aria-label="Available for assignment" />
                    <select name="status" defaultValue={m.status} className="input w-28 py-1.5 text-xs"><option value="active">Active</option><option value="disabled">Disabled</option></select>
                    <StatusBadge status={m.status} />
                    <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
        <Card title="Add user">
          <form action={invite} className="grid gap-4 md:grid-cols-3">
            <Field label="Name"><input name="name" className="input" /></Field>
            <Field label="Email *"><input name="email" type="email" required className="input" /></Field>
            <Field label="Role *"><select name="roleId" required className="input">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Branch"><select name="branchId" className="input"><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label="Team"><select name="teamId" className="input"><option value="">—</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <Field label="Reports to"><select name="managerId" className="input"><option value="">—</option>{members.map((x) => <option key={x.id} value={x.id}>{x.user.name}</option>)}</select></Field>
            <Field label="Job title"><input name="title" className="input" /></Field>
            <Field label="Languages" hint="Used by assignment rules, e.g. hi, en"><input name="languages" className="input" /></Field>
            <div className="flex items-end"><SubmitButton>Add user</SubmitButton></div>
          </form>
          <p className="mt-3 text-xs text-muted">New users get a temporary password, delivered to your notifications so you can share it securely.</p>
        </Card>
      </div>
    </>
  );
}
