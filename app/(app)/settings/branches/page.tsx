import { revalidatePath } from "next/cache";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader, Field, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { STATES, stateName } from "@/lib/india";
import { audit } from "@/lib/audit";
import { optStr, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Branches & teams" };

async function addBranch(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("user.manage");
  const b = await ctx.db.branch.create({ data: { tenantId: ctx.tenant.id, name: str(fd.get("name")), code: str(fd.get("code")).toUpperCase(), city: optStr(fd.get("city")), stateCode: str(fd.get("stateCode")) || ctx.tenant.stateCode, gstin: optStr(fd.get("gstin")) } });
  await audit(ctx, "branch.create", "Branch", b.id, null, b);
  revalidatePath("/settings/branches");
});
}
async function addTeam(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("user.manage");
  const t = await ctx.db.team.create({ data: { tenantId: ctx.tenant.id, name: str(fd.get("name")), branchId: optStr(fd.get("branchId")) } });
  await audit(ctx, "team.create", "Team", t.id, null, t);
  revalidatePath("/settings/branches");
});
}

export default async function Branches() {
  const ctx = await guard("user.manage");
  const [branches, teams] = await Promise.all([
    ctx.db.branch.findMany({ include: { _count: { select: { memberships: true } } }, orderBy: { createdAt: "asc" } }),
    ctx.db.team.findMany({ include: { branch: true, _count: { select: { memberships: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Branches & teams" subtitle="Branch scope limits branch admins to their own branch's data; reports can be compared across branches." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Branches" pad={false}>
          <table className="table"><thead><tr><th>Branch</th><th>State</th><th>People</th></tr></thead>
            <tbody>{branches.map((b) => <tr key={b.id}><td className="font-medium">{b.name} <span className="text-xs text-muted">{b.code}</span> {b.isHeadOffice && <Badge tone="blue">HO</Badge>}</td><td>{stateName(b.stateCode)}</td><td>{b._count.memberships}</td></tr>)}</tbody></table>
          <form action={addBranch} className="grid gap-3 border-t border-line p-4 md:grid-cols-2">
            <Field label="Name"><input name="name" required className="input" placeholder="Lucknow Branch" /></Field>
            <Field label="Code"><input name="code" required className="input" placeholder="LKO" /></Field>
            <Field label="City"><input name="city" className="input" /></Field>
            <Field label="State"><select name="stateCode" defaultValue={ctx.tenant.stateCode} className="input">{Object.entries(STATES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
            <Field label="GSTIN (if separate)"><input name="gstin" className="input" /></Field>
            <div className="flex items-end"><SubmitButton>Add branch</SubmitButton></div>
          </form>
        </Card>
        <Card title="Teams" pad={false}>
          <table className="table"><thead><tr><th>Team</th><th>Branch</th><th>People</th></tr></thead>
            <tbody>{teams.map((t) => <tr key={t.id}><td className="font-medium">{t.name}</td><td>{t.branch?.name ?? "—"}</td><td>{t._count.memberships}</td></tr>)}</tbody></table>
          <form action={addTeam} className="flex flex-wrap gap-2 border-t border-line p-4">
            <input name="name" required placeholder="Team name" className="input w-48" />
            <select name="branchId" className="input w-48"><option value="">No branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <SubmitButton>Add team</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
