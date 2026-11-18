import Link from "next/link";
import { notFound } from "next/navigation";
import { guard, has, hasModule, scopeWhere, phoneFor } from "@/lib/auth";
import { CustomFieldInputs, CustomFieldList } from "@/components/CustomFields";
import { SendMessage } from "@/components/SendMessage";
import { Card, PageHeader, ScoreBadge, StatusBadge, Field, Badge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CallPanel } from "@/components/CallPanel";
import { LeadInsight } from "./LeadInsight";
import { addNoteAction, addFollowUpAction, changeStatusAction, assignLeadAction, convertLeadAction, updateLeadAction } from "../actions";
import { DISPOSITIONS, dispositionLabel } from "@/lib/telephony";
import { aiEnabled } from "@/lib/ai";
import { inr } from "@/lib/money";
import { STATES } from "@/lib/india";
import { fmtDate, fmtDuration, timeAgo, titleCase } from "@/lib/utils";

const ACT_DOT: Record<string, string> = { call: "bg-green-600", note: "bg-brand-500", status_change: "bg-violet-600", system: "bg-gray-400", ai: "bg-amber-500", email: "bg-cyan-600", whatsapp: "bg-green-500", meeting: "bg-blue-700" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("lead.view", "crm");
  const lead = await ctx.db.lead.findFirst({
    where: { id, deletedAt: null, ...(await scopeWhere(ctx, "lead.view")) },
    include: {
      owner: { include: { user: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 60, include: { actor: { include: { user: true } } } },
      followUps: { where: { status: "pending" }, orderBy: { dueAt: "asc" } },
      calls: { orderBy: { startedAt: "desc" }, take: 10, include: { agent: { include: { user: true } } } },
      deals: { include: { stage: true } },
    },
  });
  if (!lead) notFound();
  const [members, defs, templates] = await Promise.all([
    has(ctx, "lead.assign") ? ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }) : [],
    ctx.db.customFieldDef.findMany({ where: { entity: "lead" }, orderBy: { order: "asc" } }),
    has(ctx, "message.send") ? ctx.db.messageTemplate.findMany({ where: { isActive: true }, select: { id: true, name: true, channel: true } }) : [],
  ]);
  const phone = phoneFor(ctx, lead.phone);
  const custom = (lead.custom ?? {}) as Record<string, unknown>;
  const canEdit = has(ctx, "lead.edit");
  const canCall = has(ctx, "call.make") && hasModule(ctx, "calling");

  return (
    <>
      <PageHeader back={{ href: "/leads", label: "Leads" }}
        title={<span className="flex items-center gap-2">{lead.name} <ScoreBadge score={lead.score} band={lead.scoreBand} /> <StatusBadge status={lead.status} /></span>}
        subtitle={<>LD-{lead.number}{lead.companyName && ` · ${lead.companyName}`} · {titleCase(lead.source)} · created {timeAgo(lead.createdAt)}</>}
        actions={lead.contactId ? <Link href={`/contacts/${lead.contactId}`} className="btn-secondary">View customer</Link> : null}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Activity timeline">
            <form action={addNoteAction.bind(null, lead.id)} className="mb-5 flex gap-2">
              <select name="type" className="input w-32"><option value="note">Note</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select>
              <input name="body" required placeholder="Add a note — requirement, objection, next step…" className="input flex-1" />
              <SubmitButton className="btn-primary">Add</SubmitButton>
            </form>
            {lead.activities.length ? (
              <ol className="relative space-y-4 border-l border-line pl-5">
                {lead.activities.map((a) => (
                  <li key={a.id} className="relative">
                    <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${ACT_DOT[a.type] ?? "bg-gray-400"}`} />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted">{a.type === "ai" ? "AI" : titleCase(a.type)}{a.actor && ` · ${a.actor.user.name}`}</span>
                      <span className="shrink-0 text-xs text-muted" title={a.createdAt.toISOString()}>{fmtDate(a.createdAt, true)}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{a.body}</p>
                  </li>
                ))}
              </ol>
            ) : <Empty title="No activity yet" />}
          </Card>

          <Card title="Calls" pad={false}>
            {lead.calls.length ? (
              <table className="table">
                <thead><tr><th>When</th><th>Agent</th><th>Outcome</th><th>Talk</th><th className="hidden md:table-cell">Notes</th></tr></thead>
                <tbody>{lead.calls.map((c) => (
                  <tr key={c.id}><td>{fmtDate(c.startedAt, true)}</td><td>{c.agent.user.name}</td><td>{dispositionLabel(c.disposition) ?? <StatusBadge status={c.status} />}</td><td className="tabular-nums">{fmtDuration(c.talkSeconds)}</td><td className="hidden max-w-xs truncate text-muted md:table-cell">{c.notes}</td></tr>
                ))}</tbody>
              </table>
            ) : <Empty title="No calls yet" />}
          </Card>

          {canEdit && (
            <details className="card">
              <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">Edit lead details</summary>
              <form action={updateLeadAction.bind(null, lead.id)} className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
                <Field label="Name"><input name="name" defaultValue={lead.name} className="input" /></Field>
                <Field label="Company"><input name="companyName" defaultValue={lead.companyName ?? ""} className="input" /></Field>
                {ctx.canUnmask ? <Field label="Mobile"><input name="phone" defaultValue={lead.phone ?? ""} className="input" /></Field> : <Field label="Mobile" hint="Masked for your role"><input disabled value={phone ?? ""} className="input" /></Field>}
                <Field label="Email"><input name="email" defaultValue={lead.email ?? ""} className="input" /></Field>
                <Field label="Product"><input name="product" defaultValue={lead.product ?? ""} className="input" /></Field>
                <Field label="Budget (₹)"><input name="budget" defaultValue={lead.budget ? Number(lead.budget) / 100 : ""} className="input" /></Field>
                <Field label="City"><input name="city" defaultValue={lead.city ?? ""} className="input" /></Field>
                <Field label="State"><input name="state" defaultValue={lead.state ?? ""} className="input" /></Field>
                <Field label="Language"><input name="language" defaultValue={lead.language ?? ""} className="input" /></Field>
                <Field label="Campaign"><input name="campaign" defaultValue={lead.campaign ?? ""} className="input" /></Field>
                <Field label="Priority"><select name="priority" defaultValue={lead.priority} className="input"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>
                <Field label="Tags"><input name="tags" defaultValue={lead.tags.join(", ")} className="input" /></Field>
                <CustomFieldInputs defs={defs} values={custom} />
                <div className="md:col-span-2"><SubmitButton>Save changes</SubmitButton></div>
              </form>
            </details>
          )}
        </div>

        <div className="space-y-4">
          {canCall && <CallPanel leadId={lead.id} name={lead.name} phone={phone} dispositions={DISPOSITIONS} />}
          {has(ctx, "message.send") && <SendMessage leadId={lead.id} templates={templates} aiOn={has(ctx, "ai.use") && hasModule(ctx, "ai") && aiEnabled()} />}

          {has(ctx, "ai.use") && hasModule(ctx, "ai") && aiEnabled() && <Card title="AI Lead Intelligence"><LeadInsight leadId={lead.id} /></Card>}

          <Card title="Details">
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-muted">Mobile</dt><dd>{phone ?? "—"}</dd>
              <dt className="text-muted">Email</dt><dd className="truncate">{lead.email ?? "—"}</dd>
              <dt className="text-muted">Product</dt><dd>{lead.product ?? "—"}</dd>
              <dt className="text-muted">Budget</dt><dd>{lead.budget ? inr(lead.budget, false) : "—"}</dd>
              <dt className="text-muted">Location</dt><dd>{[lead.city, lead.state].filter(Boolean).join(", ") || "—"}</dd>
              <dt className="text-muted">Campaign</dt><dd>{lead.campaign ?? "—"}</dd>
              <dt className="text-muted">Priority</dt><dd className="capitalize">{lead.priority}</dd>
              <dt className="text-muted">First response</dt><dd>{lead.firstResponseAt ? `${Math.round((lead.firstResponseAt.getTime() - lead.createdAt.getTime()) / 60000)} min` : <span className="text-amber-700">Not contacted</span>}</dd>
              <dt className="text-muted">Tags</dt><dd className="flex flex-wrap gap-1">{lead.tags.length ? lead.tags.map((t) => <Badge key={t}>{t}</Badge>) : "—"}</dd>
              <CustomFieldList defs={defs} values={custom} />
            </dl>
          </Card>

          <Card title="Owner">
            <div className="text-sm">{lead.owner?.user.name ?? <span className="text-amber-700">Unassigned</span>}</div>
            {members.length > 0 && (
              <form action={assignLeadAction.bind(null, lead.id)} className="mt-3 flex gap-2">
                <select name="ownerId" defaultValue={lead.ownerId ?? ""} className="input">{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select>
                <SubmitButton className="btn-secondary">Assign</SubmitButton>
              </form>
            )}
          </Card>

          {has(ctx, "followup.create") && (
            <Card title="Follow-ups">
              {lead.followUps.map((f) => (
                <div key={f.id} className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <div className={f.dueAt < new Date() ? "font-medium text-red-700" : "font-medium"}>{fmtDate(f.dueAt, true)} · {f.type}</div>
                  {f.note && <div className="text-xs text-muted">{f.note}</div>}
                </div>
              ))}
              <form action={addFollowUpAction.bind(null, lead.id)} className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <input type="datetime-local" name="dueAt" required className="input min-w-0 flex-1" />
                  <select name="type" className="input w-28"><option value="call">Call</option><option value="meeting">Meeting</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select>
                </div>
                <input name="note" placeholder="What to discuss" className="input" />
                <SubmitButton className="btn-secondary w-full">Schedule follow-up</SubmitButton>
              </form>
            </Card>
          )}

          {canEdit && lead.status !== "converted" && (
            <Card title="Move forward">
              <form action={changeStatusAction.bind(null, lead.id)} className="space-y-2">
                <select name="status" defaultValue={lead.status} className="input">{["new", "contacted", "qualified", "unqualified", "lost"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
                <input name="lostReason" placeholder="Lost reason (required if lost)" className="input" />
                <SubmitButton className="btn-secondary w-full">Update status</SubmitButton>
              </form>
              <form action={convertLeadAction.bind(null, lead.id)} className="mt-4 space-y-2 border-t border-line pt-4">
                <div className="text-sm font-medium">Convert to customer</div>
                <select name="stateCode" defaultValue={ctx.tenant.stateCode} className="input">{Object.entries(STATES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="createDeal" defaultChecked /> Create a deal in the pipeline</label>
                <input name="dealTitle" placeholder="Deal title (optional)" className="input" />
                <input name="dealAmount" placeholder={`Deal value ₹ (default ${lead.budget ? Number(lead.budget) / 100 : 0})`} className="input" />
                <SubmitButton className="btn-primary w-full">Convert</SubmitButton>
              </form>
            </Card>
          )}

          {lead.deals.length > 0 && (
            <Card title="Deals">
              {lead.deals.map((d) => <Link key={d.id} href={`/pipeline?highlight=${d.id}`} className="block text-sm hover:underline">{d.title} · {d.stage.name} · {inr(d.amount, false)}</Link>)}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
