import Link from "next/link";
import { notFound } from "next/navigation";
import { guard, has, hasModule, scopeWhere, phoneFor } from "@/lib/auth";
import { CustomFieldList } from "@/components/CustomFields";
import { SendMessage } from "@/components/SendMessage";
import { aiEnabled } from "@/lib/ai";
import { Card, PageHeader, StatusBadge, Stat, Empty, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CallPanel } from "@/components/CallPanel";
import { ContactFields } from "../ContactFields";
import { addContactNoteAction, updateContactAction } from "../actions";
import { DISPOSITIONS } from "@/lib/telephony";
import { inr, inrCompact, toNum } from "@/lib/money";
import { fmtDate, titleCase } from "@/lib/utils";
import { stateName } from "@/lib/india";

/** Customer 360 (BRD §51): everything about one customer on one page. */
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("contact.view", "crm");
  const c = await ctx.db.contact.findFirst({
    where: { id, deletedAt: null, ...(await scopeWhere(ctx, "contact.view")) },
    include: {
      owner: { include: { user: true } }, leads: true, deals: { include: { stage: true } },
      quotations: { orderBy: { createdAt: "desc" }, take: 10 }, invoices: { orderBy: { issueDate: "desc" }, take: 20 },
      payments: { orderBy: { receivedOn: "desc" }, take: 10 }, tickets: { orderBy: { createdAt: "desc" }, take: 10 },
      activities: { orderBy: { createdAt: "desc" }, take: 40, include: { actor: { include: { user: true } } } },
    },
  });
  if (!c) notFound();
  const [defs, templates] = await Promise.all([
    ctx.db.customFieldDef.findMany({ where: { entity: "contact" }, orderBy: { order: "asc" } }),
    has(ctx, "message.send") ? ctx.db.messageTemplate.findMany({ where: { isActive: true }, select: { id: true, name: true, channel: true } }) : [],
  ]);
  const billed = c.invoices.filter((i) => !["draft", "cancelled"].includes(i.status));
  const lifetime = billed.reduce((a, i) => a + toNum(i.total), 0);
  const outstanding = billed.reduce((a, i) => a + toNum(i.balance), 0);
  const last = billed[0]?.issueDate;
  const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86400_000) : null;
  const overdue = billed.filter((i) => toNum(i.balance) > 0 && i.dueDate < new Date()).length;
  const summary = billed.length
    ? `Customer has purchased ${billed.length} time${billed.length > 1 ? "s" : ""} for ${inrCompact(lifetime)}. Last purchase was ${daysSince} days ago.${outstanding ? ` ${inrCompact(outstanding)} is outstanding${overdue ? ` (${overdue} overdue)` : ""}.` : ""} ${daysSince! > 60 ? "Recommended action: reactivation call or offer." : lifetime > 10000000 ? "High-value customer — keep engagement warm." : ""}`
    : "No invoices yet. Recommended action: send a quotation.";

  return (
    <>
      <PageHeader back={{ href: "/contacts", label: "Customers" }} title={<span className="flex items-center gap-2">{c.name} {c.dnd && <Badge tone="red">DND</Badge>}</span>}
        subtitle={[c.companyName, c.gstin, stateName(c.stateCode)].filter(Boolean).join(" · ")}
        actions={<>
          {has(ctx, "quotation.create") && <Link href={`/quotations/new?contactId=${c.id}`} className="btn-secondary">New quotation</Link>}
          {has(ctx, "invoice.create") && <Link href={`/invoices/new?contactId=${c.id}`} className="btn-primary">New invoice</Link>}
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Lifetime value" value={inrCompact(lifetime)} hint={`${billed.length} invoices`} />
        <Stat label="Outstanding" value={inrCompact(outstanding)} tone={overdue ? "bad" : undefined} hint={overdue ? `${overdue} overdue` : "On time"} />
        <Stat label="Last purchase" value={daysSince != null ? `${daysSince}d ago` : "—"} tone={daysSince != null && daysSince > 60 ? "warn" : undefined} hint={last ? fmtDate(last) : undefined} />
        <Stat label="Open deals" value={c.deals.filter((d) => d.stage.type === "open").length} />
      </div>

      <Card className="mb-6 border-brand-100 bg-brand-50/40"><p className="text-sm"><b>Customer summary:</b> {summary}</p></Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Invoices" pad={false}>
            {c.invoices.length ? <table className="table"><thead><tr><th>Number</th><th>Date</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr></thead>
              <tbody>{c.invoices.map((i) => <tr key={i.id}><td><Link className="hover:underline" href={`/invoices/${i.id}`}>{i.number ?? "Draft"}</Link></td><td>{fmtDate(i.issueDate)}</td><td><StatusBadge status={i.status} /></td><td className="text-right tabular-nums">{inr(i.total)}</td><td className="text-right tabular-nums">{inr(i.balance)}</td></tr>)}</tbody></table>
              : <Empty title="No invoices" />}
          </Card>
          <Card title="Quotations" pad={false}>
            {c.quotations.length ? <table className="table"><thead><tr><th>Number</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr></thead>
              <tbody>{c.quotations.map((q) => <tr key={q.id}><td><Link className="hover:underline" href={`/quotations/${q.id}`}>{q.number}</Link></td><td>{fmtDate(q.issueDate)}</td><td><StatusBadge status={q.status} /></td><td className="text-right tabular-nums">{inr(q.total)}</td></tr>)}</tbody></table>
              : <Empty title="No quotations" />}
          </Card>
          <Card title="Timeline">
            <form action={addContactNoteAction.bind(null, c.id)} className="mb-4 flex gap-2"><input name="body" placeholder="Add a note" className="input" required /><SubmitButton>Add</SubmitButton></form>
            <ul className="space-y-3">{c.activities.map((a) => <li key={a.id} className="text-sm"><span className="text-xs text-muted">{fmtDate(a.createdAt, true)} · {titleCase(a.type)}{a.actor && ` · ${a.actor.user.name}`}</span><p>{a.body}</p></li>)}</ul>
            {!c.activities.length && <Empty title="No activity" />}
          </Card>
        </div>
        <div className="space-y-4">
          {has(ctx, "call.make") && hasModule(ctx, "calling") && <CallPanel contactId={c.id} name={c.name} phone={c.dnd ? null : phoneFor(ctx, c.phone)} dispositions={DISPOSITIONS} />}
          {has(ctx, "message.send") && <SendMessage contactId={c.id} templates={templates} aiOn={has(ctx, "ai.use") && hasModule(ctx, "ai") && aiEnabled()} />}
          {defs.length > 0 && <Card title="Details"><dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm"><dt className="text-muted">Phone</dt><dd>{phoneFor(ctx, c.phone) ?? "—"}</dd><CustomFieldList defs={defs} values={(c.custom ?? {}) as Record<string, unknown>} /></dl></Card>}
          <Card title="Payments">
            {c.payments.length ? <ul className="space-y-1.5 text-sm">{c.payments.map((p) => <li key={p.id} className="flex justify-between"><span>{fmtDate(p.receivedOn)} · {titleCase(p.method)}</span><span className="tabular-nums">{inr(p.amount)}</span></li>)}</ul> : <p className="text-sm text-muted">No payments yet.</p>}
          </Card>
          <Card title="Deals">{c.deals.length ? c.deals.map((d) => <div key={d.id} className="text-sm">{d.title} · {d.stage.name} · {inr(d.amount, false)}</div>) : <p className="text-sm text-muted">None</p>}</Card>
          <Card title="Support tickets">{c.tickets.length ? c.tickets.map((t) => <Link href={`/tickets?id=${t.id}`} key={t.id} className="block text-sm hover:underline">#{t.number} {t.subject} · {t.status}</Link>) : <p className="text-sm text-muted">None</p>}</Card>
          {has(ctx, "contact.edit") && (
            <details className="card">
              <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">Edit customer</summary>
              <form action={updateContactAction.bind(null, c.id)} className="space-y-4 border-t border-line p-5">
                <ContactFields c={c} defaultState={ctx.tenant.stateCode} defs={defs} canUnmask={ctx.canUnmask} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dnd" defaultChecked={c.dnd} /> Do not call (opt-out)</label>
                <SubmitButton>Save</SubmitButton>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
