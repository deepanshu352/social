import { guard } from "@/lib/auth";
import { PageHeader, Stat } from "@/components/ui";
import { DISPOSITIONS } from "@/lib/telephony";
import { Dialer } from "./Dialer";
import { startOfDay } from "@/lib/utils";

export const metadata = { title: "Power Dialer" };

export default async function DialerPage() {
  const ctx = await guard("call.make", "dialer");
  const today = startOfDay();
  const [calls, connected, talk] = await Promise.all([
    ctx.db.callLog.count({ where: { agentId: ctx.membership.id, startedAt: { gte: today } } }),
    ctx.db.callLog.count({ where: { agentId: ctx.membership.id, startedAt: { gte: today }, talkSeconds: { gt: 0 } } }),
    ctx.db.callLog.aggregate({ where: { agentId: ctx.membership.id, startedAt: { gte: today } }, _sum: { talkSeconds: true } }),
  ]);
  const script = `Namaste, main ${ctx.user.name} bol raha/rahi hoon ${ctx.tenant.name} se.\n\n1. Confirm name & that it's a good time.\n2. Reference their enquiry (source / product).\n3. Discover: requirement, quantity, timeline, budget, decision-maker.\n4. Pitch the matching product & one proof point.\n5. Handle objection (price → value, timing → schedule follow-up).\n6. Close: book a demo / send quotation on WhatsApp.\n7. Never promise discounts above your limit or delivery dates you can't confirm.`;
  return (
    <>
      <PageHeader title="Power Dialer" subtitle="Sequential calling: call → disposition → next lead, automatically." />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="My calls today" value={calls} />
        <Stat label="Connected" value={connected} hint={calls ? `${Math.round((connected / calls) * 100)}% connect rate` : undefined} />
        <Stat label="Talk time" value={`${Math.round((talk._sum.talkSeconds ?? 0) / 60)} min`} />
      </div>
      <Dialer dispositions={DISPOSITIONS} script={script} />
    </>
  );
}
