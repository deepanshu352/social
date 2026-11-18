import { revalidatePath } from "next/cache";
import { authorize, guard } from "@/lib/auth";
import { Card, PageHeader, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizePhone, fmtDate, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Calling & DND" };

async function saveHours(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("call.manage");
  const data = { callingStart: str(fd.get("callingStart")) || "09:00", callingEnd: str(fd.get("callingEnd")) || "21:00" };
  await prisma.tenant.update({ where: { id: ctx.tenant.id }, data });
  await audit(ctx, "calling.hours", "Tenant", ctx.tenant.id, { start: ctx.tenant.callingStart, end: ctx.tenant.callingEnd }, data);
  revalidatePath("/settings/calling");
});
}
async function addDnd(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("call.manage");
  const nums = str(fd.get("phones")).split(/[\s,;]+/).map(normalizePhone).filter(Boolean) as string[];
  for (const phone of nums) await ctx.db.dndNumber.upsert({ where: { tenantId_phone: { tenantId: ctx.tenant.id, phone } }, create: { tenantId: ctx.tenant.id, phone, reason: str(fd.get("reason")) || "Manual" }, update: {} });
  await audit(ctx, "dnd.add", "DndNumber", null, null, { count: nums.length });
  revalidatePath("/settings/calling");
});
}
async function removeDnd(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("call.manage");
  await ctx.db.dndNumber.delete({ where: { id } });
  await audit(ctx, "dnd.remove", "DndNumber", id);
  revalidatePath("/settings/calling");
});
}

export default async function CallingSettings() {
  const ctx = await guard("call.manage", "calling");
  const dnd = await ctx.db.dndNumber.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <>
      <PageHeader title="Calling & compliance" subtitle="Enforced on the server for every call, including the power dialer." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Calling hours">
          <form action={saveHours} className="flex flex-wrap items-end gap-3">
            <Field label="From"><input type="time" name="callingStart" defaultValue={ctx.tenant.callingStart} className="input" /></Field>
            <Field label="To"><input type="time" name="callingEnd" defaultValue={ctx.tenant.callingEnd} className="input" /></Field>
            <SubmitButton>Save</SubmitButton>
          </form>
          <p className="mt-3 text-xs text-muted">Timezone {ctx.tenant.timezone}. Commercial calls outside these hours are blocked and logged. Check the telecom rules for each region you call into.</p>
        </Card>
        <Card title="Telephony provider">
          <p className="text-sm">Current: <b>Demo provider</b> (calls are simulated; the agent marks the outcome).</p>
          <p className="mt-2 text-sm text-muted">To go live, implement the <code>TelephonyProvider</code> interface in <code>lib/telephony.ts</code> for your provider and point its status callbacks to <code>/api/webhooks/telephony</code>.</p>
        </Card>
        <Card title={`Do-Not-Call list (${dnd.length})`} className="lg:col-span-2" pad={false}>
          <form action={addDnd} className="flex flex-wrap gap-2 border-b border-line p-4">
            <textarea name="phones" rows={1} placeholder="Numbers, comma or newline separated" className="input min-w-64 flex-1" required />
            <input name="reason" placeholder="Reason" className="input w-48" />
            <SubmitButton>Add to DND</SubmitButton>
          </form>
          <table className="table"><thead><tr><th>Number</th><th>Reason</th><th>Added</th><th></th></tr></thead>
            <tbody>{dnd.map((d) => <tr key={d.id}><td className="font-mono text-xs">{d.phone}</td><td>{d.reason}</td><td>{fmtDate(d.createdAt)}</td><td><form action={removeDnd.bind(null, d.id)}><SubmitButton className="btn-ghost btn-sm" confirm="Remove from DND? Only do this with the customer's consent.">Remove</SubmitButton></form></td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
