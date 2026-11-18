import Link from "next/link";
import { revalidatePath } from "next/cache";
import { authorize, guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Empty, Tabs, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { nextNumber } from "@/lib/db";
import { emit } from "@/lib/events";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { fmtDate, optStr, str, timeAgo } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Support" };
const SLA_HOURS: Record<string, number> = { urgent: 4, high: 8, medium: 24, low: 72 };

async function createTicket(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("ticket.manage");
  const priority = (str(fd.get("priority")) || "medium") as "low" | "medium" | "high" | "urgent";
  const assigneeId = optStr(fd.get("assigneeId")) ?? ctx.membership.id;
  const t = await ctx.db.ticket.create({
    data: { tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "ticket"), subject: str(fd.get("subject")), body: optStr(fd.get("body")), contactId: optStr(fd.get("contactId")), category: optStr(fd.get("category")), priority, assigneeId, dueAt: new Date(Date.now() + SLA_HOURS[priority] * 3600_000) },
  });
  if (assigneeId !== ctx.membership.id) await notify(ctx.tenant.id, assigneeId, `Ticket #${t.number} assigned to you`, t.subject, `/tickets?id=${t.id}`);
  await emit(ctx.tenant.id, "ticket.created", { id: t.id, priority, ownerId: assigneeId, contactId: t.contactId });
  await audit(ctx, "ticket.create", "Ticket", t.id);
  revalidatePath("/tickets");
});
}

async function updateTicket(id: string, fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("ticket.manage");
  const status = str(fd.get("status"));
  await ctx.db.ticket.update({ where: { id }, data: { status, assigneeId: optStr(fd.get("assigneeId")) ?? undefined, resolvedAt: ["resolved", "closed"].includes(status) ? new Date() : null } });
  const t = await ctx.db.ticket.findFirstOrThrow({ where: { id } });
  const note = optStr(fd.get("note"));
  if (note && t.contactId) await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, contactId: t.contactId, type: "note", body: `Ticket #${t.number}: ${note}`, actorId: ctx.membership.id } });
  revalidatePath("/tickets");
});
}

export default async function Tickets({ searchParams }: { searchParams: Promise<{ status?: string; id?: string }> }) {
  const ctx = await guard("ticket.view", "support");
  const { status = "open", id } = await searchParams;
  const scope = await scopeWhere(ctx, "ticket.view", "assigneeId", null);
  const where = { ...scope, ...(status === "open" ? { status: { in: ["open", "in_progress"] } } : { status }) };
  const [tickets, members, contacts, breached] = await Promise.all([
    ctx.db.ticket.findMany({ where, include: { contact: true, assignee: { include: { user: true } } }, orderBy: [{ dueAt: "asc" }], take: 200 }),
    ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }),
    ctx.db.contact.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    ctx.db.ticket.count({ where: { ...scope, status: { in: ["open", "in_progress"] }, dueAt: { lt: new Date() } } }),
  ]);
  const sel = tickets.find((t) => t.id === id);
  return (
    <>
      <PageHeader title="Support tickets" subtitle={breached ? `${breached} ticket(s) past SLA` : "All tickets within SLA"} />
      <Tabs active={status} items={[["open", "Open"], ["resolved", "Resolved"], ["closed", "Closed"]].map(([k, l]) => ({ key: k, label: l, href: `/tickets?status=${k}` }))} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card pad={false}>
          {tickets.length ? <table className="table">
            <thead><tr><th>Ticket</th><th>Customer</th><th>Priority</th><th>Status</th><th>SLA due</th><th className="hidden md:table-cell">Assignee</th></tr></thead>
            <tbody>{tickets.map((t) => (
              <tr key={t.id} className={t.id === id ? "bg-brand-50/50" : ""}>
                <td><Link href={`/tickets?status=${status}&id=${t.id}`} className="font-medium hover:underline">#{t.number} {t.subject}</Link><div className="text-xs text-muted">{t.category} · {timeAgo(t.createdAt)}</div></td>
                <td>{t.contact?.name ?? "—"}</td><td><StatusBadge status={t.priority} /></td><td><StatusBadge status={t.status} /></td>
                <td className={t.dueAt && t.dueAt < new Date() && ["open", "in_progress"].includes(t.status) ? "font-medium text-red-700" : ""}>{fmtDate(t.dueAt, true)}</td>
                <td className="hidden md:table-cell">{t.assignee?.user.name ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table> : <Empty title="No tickets" />}
        </Card>
        {has(ctx, "ticket.manage") && (sel ? (
          <Card title={`#${sel.number} ${sel.subject}`} actions={<Link href={`/tickets?status=${status}`} className="text-xs text-muted">Close</Link>}>
            <p className="mb-4 whitespace-pre-wrap text-sm">{sel.body ?? "No description."}</p>
            <form action={updateTicket.bind(null, sel.id)} className="space-y-3">
              <Field label="Status"><select name="status" defaultValue={sel.status} className="input">{["open", "in_progress", "resolved", "closed"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></Field>
              <Field label="Assignee"><select name="assigneeId" defaultValue={sel.assigneeId ?? ""} className="input">{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select></Field>
              <Field label="Internal note"><textarea name="note" rows={2} className="input" /></Field>
              <SubmitButton>Update ticket</SubmitButton>
            </form>
          </Card>
        ) : (
          <Card title="New ticket">
            <form action={createTicket} className="space-y-3">
              <Field label="Subject *"><input name="subject" required className="input" /></Field>
              <Field label="Customer"><select name="contactId" className="input"><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Priority"><select name="priority" defaultValue="medium" className="input"><option value="low">Low (72h)</option><option value="medium">Medium (24h)</option><option value="high">High (8h)</option><option value="urgent">Urgent (4h)</option></select></Field>
                <Field label="Category"><select name="category" className="input"><option>General</option><option>Billing</option><option>Delivery</option><option>Product issue</option><option>Installation</option></select></Field>
              </div>
              <Field label="Assignee"><select name="assigneeId" className="input"><option value="">Me</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select></Field>
              <Field label="Description"><textarea name="body" rows={3} className="input" /></Field>
              <SubmitButton>Create ticket</SubmitButton>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
