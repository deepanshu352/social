import Link from "next/link";
import { guard } from "@/lib/auth";
import { Card, PageHeader, Badge, Empty, Stat } from "@/components/ui";
import { WfTabs } from "../workflows/Tabs";
import { fmtDate, daysAgo } from "@/lib/utils";

export const metadata = { title: "Messages" };
const TONE: Record<string, "green" | "blue" | "red" | "amber" | "gray"> = { sent: "green", simulated: "blue", failed: "red", blocked: "amber" };

export default async function Messages({ searchParams }: { searchParams: Promise<{ channel?: string; status?: string }> }) {
  const ctx = await guard("workflow.manage", "workflows");
  const sp = await searchParams;
  const where = { ...(sp.channel ? { channel: sp.channel } : {}), ...(sp.status ? { status: sp.status } : {}) };
  const [rows, byStatus] = await Promise.all([
    ctx.db.messageLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    ctx.db.messageLog.groupBy({ by: ["status"], where: { createdAt: { gte: daysAgo(30) } }, _count: true }),
  ]);
  const c = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
  return (
    <>
      <PageHeader title="Communication log" subtitle="Every email, WhatsApp and SMS sent by people and workflows." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Sent (30d)" value={c("sent")} /><Stat label="Simulated (no provider)" value={c("simulated")} hint="Set RESEND / WHATSAPP keys to go live" />
        <Stat label="Blocked by consent / DND" value={c("blocked")} tone={c("blocked") ? "warn" : undefined} /><Stat label="Failed" value={c("failed")} tone={c("failed") ? "bad" : "good"} />
      </div>
      <WfTabs active="messages" />
      <form className="mb-4 flex gap-2" action="/messages">
        <select name="channel" defaultValue={sp.channel ?? ""} className="input w-40"><option value="">All channels</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></select>
        <select name="status" defaultValue={sp.status ?? ""} className="input w-40"><option value="">Any status</option>{["sent", "simulated", "blocked", "failed"].map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card pad={false}>
        {rows.length ? <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Status</th><th>Message</th><th>Source</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap text-xs">{fmtDate(m.createdAt, true)}</td>
              <td><Badge tone={m.channel === "email" ? "blue" : m.channel === "whatsapp" ? "green" : "amber"}>{m.channel}</Badge></td>
              <td className="text-xs">{m.leadId ? <Link className="link" href={`/leads/${m.leadId}`}>{m.to}</Link> : m.contactId ? <Link className="link" href={`/contacts/${m.contactId}`}>{m.to}</Link> : m.to}</td>
              <td><Badge tone={TONE[m.status] ?? "gray"}>{m.status}</Badge>{m.error && <div className="text-[11px] text-muted">{m.error}</div>}</td>
              <td className="max-w-md text-xs">{m.subject && <b>{m.subject} — </b>}<span className="line-clamp-2">{m.body}</span></td>
              <td className="text-xs">{m.workflowRunId ? <Link className="link" href={`/workflows/runs/${m.workflowRunId}`}>Workflow</Link> : "Manual"}</td>
            </tr>
          ))}</tbody>
        </table></div> : <Empty title="No messages yet" />}
      </Card>
    </>
  );
}
