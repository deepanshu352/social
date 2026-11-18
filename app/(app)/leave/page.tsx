import { revalidatePath } from "next/cache";
import { authorize, guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Field, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { leaveBalances, workingDays, LEAVE_TYPES } from "@/lib/hr";
import { requestApproval } from "@/lib/approvals";
import { emit } from "@/lib/events";
import { audit } from "@/lib/audit";
import { fmtDate, str, titleCase } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Leave" };

async function applyLeave(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("hr.self", { mod: "hr" });
  const from = new Date(`${str(fd.get("from"))}T00:00:00.000Z`), to = new Date(`${str(fd.get("to"))}T00:00:00.000Z`);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) throw new Error("Pick a valid date range");
  const half = fd.get("half") === "on";
  const days = half ? 0.5 : workingDays(from, to);
  if (!days) throw new Error("The range has no working days");
  const type = str(fd.get("type"));
  if (!(LEAVE_TYPES as readonly string[]).includes(type)) throw new Error("Invalid leave type");
  const bal = await leaveBalances(ctx.tenant.id, ctx.membership.id, ctx.tenant.leavePolicy as Record<string, number>);
  if (bal[type].left < days) throw new Error(`Not enough ${type} leave (${bal[type].left} left)`);
  const overlap = await ctx.db.leaveRequest.findFirst({ where: { membershipId: ctx.membership.id, status: { in: ["pending", "approved"] }, fromDate: { lte: to }, toDate: { gte: from } } });
  if (overlap) throw new Error("You already have leave in this period");
  const l = await ctx.db.leaveRequest.create({ data: { tenantId: ctx.tenant.id, membershipId: ctx.membership.id, type, fromDate: from, toDate: to, days, reason: str(fd.get("reason")) || null } });
  const req = await requestApproval(ctx, "leave", l.id, `${ctx.user.name}: ${days} day(s) ${type} leave, ${fmtDate(from)} – ${fmtDate(to)}`, null);
  if (!req) await ctx.db.leaveRequest.update({ where: { id: l.id }, data: { status: "approved" } });
  await audit(ctx, "leave.apply", "LeaveRequest", l.id, null, { type, days });
  await emit(ctx.tenant.id, "leave.requested", { id: l.id, name: ctx.user.name, type, days, membershipId: ctx.membership.id, ownerId: ctx.membership.id });
  revalidatePath("/leave");
});
}

async function cancelLeave(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("hr.self");
  const l = await ctx.db.leaveRequest.findFirst({ where: { id, membershipId: ctx.membership.id, status: { in: ["pending", "approved"] } } });
  if (!l) throw new Error("Not found");
  if (l.status === "approved" && l.fromDate <= new Date()) throw new Error("Leave that has started can't be cancelled");
  await ctx.db.leaveRequest.update({ where: { id }, data: { status: "cancelled" } });
  await ctx.db.approvalRequest.updateMany({ where: { entity: "leave", entityId: id, status: "pending" }, data: { status: "cancelled" } });
  revalidatePath("/leave");
});
}

export default async function Leave() {
  const ctx = await guard("hr.self", "hr");
  const bal = await leaveBalances(ctx.tenant.id, ctx.membership.id, ctx.tenant.leavePolicy as Record<string, number>);
  const [mine, upcoming] = await Promise.all([
    ctx.db.leaveRequest.findMany({ where: { membershipId: ctx.membership.id }, orderBy: { fromDate: "desc" }, take: 50 }),
    has(ctx, "hr.view") ? ctx.db.leaveRequest.findMany({ where: { status: { in: ["approved", "pending"] }, toDate: { gte: new Date() }, ...(await scopeWhere(ctx, "hr.view", "membershipId", null)) }, include: { membership: { include: { user: true } } }, orderBy: { fromDate: "asc" }, take: 50 }) : [],
  ]);
  return (
    <>
      <PageHeader title="Leave" subtitle="Balances update instantly; requests go to your manager in Approvals." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {LEAVE_TYPES.filter((t) => t !== "unpaid").map((t) => (
          <Card key={t}><div className="text-xs font-medium text-muted">{titleCase(t)} leave</div><div className="mt-1 text-2xl font-semibold tabular-nums">{bal[t].left}<span className="text-sm font-normal text-muted"> / {bal[t].allowed}</span></div>
            <div className="mt-2 h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${bal[t].allowed ? (bal[t].left / bal[t].allowed) * 100 : 0}%` }} /></div></Card>
        ))}
        <Card><div className="text-xs font-medium text-muted">Unpaid leave used</div><div className="mt-1 text-2xl font-semibold">{bal.unpaid.used}</div></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="My requests" pad={false}>
            <table className="table"><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
              <tbody>{mine.map((l) => <tr key={l.id}><td className="capitalize">{l.type}</td><td>{fmtDate(l.fromDate)} – {fmtDate(l.toDate)}</td><td>{l.days}</td><td><StatusBadge status={l.status === "approved" ? "accepted" : l.status} /></td>
                <td>{["pending", "approved"].includes(l.status) && l.fromDate > new Date() && <form action={cancelLeave.bind(null, l.id)}><SubmitButton className="btn-ghost btn-sm" confirm="Cancel this leave request?">Cancel</SubmitButton></form>}</td></tr>)}</tbody>
            </table>
          </Card>
          {upcoming.length > 0 && (
            <Card title="Team — upcoming leave" pad={false}>
              <table className="table"><thead><tr><th>Member</th><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
                <tbody>{upcoming.map((l) => <tr key={l.id}><td>{l.membership.user.name}</td><td className="capitalize">{l.type}</td><td>{fmtDate(l.fromDate)} – {fmtDate(l.toDate)} ({l.days}d)</td><td>{l.status === "pending" ? <Badge tone="amber">Pending</Badge> : <Badge tone="green">Approved</Badge>}</td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </div>
        <Card title="Apply for leave" className="h-fit">
          <form action={applyLeave} className="space-y-3">
            <Field label="Type"><select name="type" className="input">{LEAVE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)} ({bal[t].left} left)</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="From"><input name="from" type="date" required className="input" /></Field><Field label="To"><input name="to" type="date" required className="input" /></Field></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="half" /> Half day</label>
            <Field label="Reason"><textarea name="reason" rows={2} className="input" /></Field>
            <SubmitButton>Submit request</SubmitButton>
            <p className="text-xs text-muted">Sundays are excluded automatically. Ask the AI Copilot “what is the leave policy?” for rules.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
