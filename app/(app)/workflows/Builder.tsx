"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Clock, GitBranch, Plus, Trash2, Zap, Sparkles, Filter } from "lucide-react";
import type { ActionType, Cond, Step } from "@/lib/workflows";

type Trigger = { key: string; label: string; kind: string; group: string; config?: { key: string; label: string; type: string; default: number | string }[] };
type Opts = {
  triggers: Trigger[]; actions: { key: ActionType; label: string; group: string }[]; fields: string[];
  templates: { id: string; name: string; channel: string }[]; members: { id: string; name: string }[]; roles: { key: string; name: string }[];
};
export type WorkflowDraft = { name: string; description: string; isActive: boolean; trigger: string; triggerConfig: Record<string, any>; conditions: Cond[]; steps: Step[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const OPS: [Cond["op"], string][] = [["eq", "is"], ["neq", "is not"], ["in", "is one of"], ["contains", "contains"], ["gte", "≥"], ["lte", "≤"], ["empty", "is empty / 0"], ["not_empty", "has a value"]];
const VARS = "{{lead.name}} {{lead.first_name}} {{lead.product}} {{owner.name}} {{contact.name}} {{contact.first_name}} {{invoice.number}} {{invoice.balance}} {{invoice.due_date}} {{invoice.link}} {{quotation.number}} {{quotation.link}} {{ticket.number}} {{company.name}}";

function defaultConfig(a: ActionType): Record<string, any> {
  switch (a) {
    case "send_message": return { channel: "whatsapp", to: "customer", body: "" };
    case "notify": return { to: "owner", title: "", body: "" };
    case "create_task": return { title: "", dueInHours: 24, assignTo: "owner", priority: "medium" };
    case "create_followup": return { inHours: 2, note: "", assignTo: "owner" };
    case "update_lead": return { field: "status", value: "contacted" };
    case "assign_lead": return { mode: "rules" };
    case "send_digest": return { to: "role:admin", email: true };
    default: return {};
  }
}

export function Builder({ initial, opts, action, submitLabel }: { initial: WorkflowDraft; opts: Opts; action: (fd: FormData) => void | Promise<void>; submitLabel: string }) {
  const [wf, setWf] = useState<WorkflowDraft>(initial);
  const trig = opts.triggers.find((t) => t.key === wf.trigger);
  const groups = [...new Set(opts.triggers.map((t) => t.group))];

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(wf)} />
      <div className="card card-pad grid gap-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="block"><span className="label">Workflow name</span><input required value={wf.name} onChange={(e) => setWf({ ...wf, name: e.target.value })} className="input" placeholder="e.g. Speed-to-lead" /></label>
        <label className="block"><span className="label">Description</span><input value={wf.description} onChange={(e) => setWf({ ...wf, description: e.target.value })} className="input" placeholder="What does it do?" /></label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={wf.isActive} onChange={(e) => setWf({ ...wf, isActive: e.target.checked })} className="h-4 w-4" /> Active</label>
      </div>

      <Block icon={<Zap size={15} />} tone="bg-violet-600" label="WHEN" title="Trigger">
        <div className="flex flex-wrap items-end gap-3">
          <select value={wf.trigger} onChange={(e) => { const t = opts.triggers.find((x) => x.key === e.target.value); setWf({ ...wf, trigger: e.target.value, triggerConfig: Object.fromEntries((t?.config ?? []).map((c) => [c.key, c.default])) }); }} className="input max-w-sm">
            {groups.map((g) => <optgroup key={g} label={g}>{opts.triggers.filter((t) => t.group === g).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>)}
          </select>
          {trig?.config?.map((c) => (
            <label key={c.key} className="block"><span className="label">{c.label}</span>
              <input type={c.type === "time" ? "time" : "number"} min={c.type === "weekday" ? 1 : 0} max={c.type === "weekday" ? 7 : undefined} value={wf.triggerConfig[c.key] ?? c.default}
                onChange={(e) => setWf({ ...wf, triggerConfig: { ...wf.triggerConfig, [c.key]: c.type === "time" ? e.target.value : Number(e.target.value) } })} className="input w-32" />
            </label>
          ))}
          <span className="pb-2 text-xs text-muted">{trig?.kind === "event" ? "Runs instantly when this happens." : trig?.kind === "scan" ? "Checked every 10 minutes; runs once per record." : "Runs on schedule in your company timezone."}</span>
        </div>
      </Block>

      <Block icon={<Filter size={15} />} tone="bg-gray-500" label="ONLY IF" title="Filter (optional) — the workflow starts only when these match">
        <Conditions conds={wf.conditions} fields={opts.fields} onChange={(conditions) => setWf({ ...wf, conditions })} />
      </Block>

      <div className="pl-4"><div className="h-5 w-px bg-line" /></div>
      <StepList steps={wf.steps} opts={opts} onChange={(steps) => setWf({ ...wf, steps })} />

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 border-t border-line bg-[#f5f6f8]/95 px-1 py-3 backdrop-blur">
        <p className="text-xs text-muted">Variables you can use in messages: <code className="break-all">{VARS}</code></p>
        <button className="btn-primary shrink-0">{submitLabel}</button>
      </div>
    </form>
  );
}

function Block({ icon, tone, label, title, children, actions }: { icon: React.ReactNode; tone: string; label: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide text-white ${tone}`}>{icon}{label}</span><span className="font-medium">{title}</span></div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Conditions({ conds, fields, onChange }: { conds: Cond[]; fields: string[]; onChange: (c: Cond[]) => void }) {
  return (
    <div className="space-y-2">
      {conds.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select value={c.field} onChange={(e) => onChange(conds.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)))} className="input w-56">{fields.map((f) => <option key={f}>{f}</option>)}</select>
          <select value={c.op} onChange={(e) => onChange(conds.map((x, k) => (k === i ? { ...x, op: e.target.value as Cond["op"] } : x)))} className="input w-36">{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {!["empty", "not_empty"].includes(c.op) && <input value={c.value ?? ""} onChange={(e) => onChange(conds.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} placeholder="value" className="input w-48" />}
          <button type="button" onClick={() => onChange(conds.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove condition"><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...conds, { field: fields[0], op: "eq", value: "" }])} className="btn-ghost btn-sm"><Plus size={13} /> Add condition</button>
    </div>
  );
}

function StepList({ steps, opts, onChange, nested }: { steps: Step[]; opts: Opts; onChange: (s: Step[]) => void; nested?: boolean }) {
  const [adding, setAdding] = useState(false);
  const update = (i: number, s: Step) => onChange(steps.map((x, k) => (k === i ? s : x)));
  const move = (i: number, d: number) => { const a = [...steps]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a); };
  const add = (s: Step) => { onChange([...steps, s]); setAdding(false); };
  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <div key={s.id}>
          <StepCard step={s} opts={opts} onChange={(n) => update(i, n)} onDelete={() => onChange(steps.filter((_, k) => k !== i))}
            onUp={i > 0 ? () => move(i, -1) : undefined} onDown={i < steps.length - 1 ? () => move(i, 1) : undefined} />
          {i < steps.length - 1 && <div className="pl-4"><div className="h-3 w-px bg-line" /></div>}
        </div>
      ))}
      {adding ? (
        <div className={`flex flex-wrap gap-2 rounded-xl border border-dashed border-brand-500 bg-brand-50/40 p-3 ${nested ? "" : ""}`}>
          <button type="button" className="btn-secondary btn-sm" onClick={() => add({ id: uid(), type: "action", action: "send_message", config: defaultConfig("send_message") })}><Zap size={13} /> Action</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => add({ id: uid(), type: "wait", amount: 1, unit: "hours" })}><Clock size={13} /> Wait</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => add({ id: uid(), type: "condition", match: "all", conditions: [{ field: opts.fields[0], op: "eq", value: "" }], then: [], else: [] })}><GitBranch size={13} /> If / else</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`btn-ghost btn-sm ${nested ? "" : "border border-dashed border-line"}`}><Plus size={13} /> Add step</button>
      )}
    </div>
  );
}

function StepCard({ step, opts, onChange, onDelete, onUp, onDown }: { step: Step; opts: Opts; onChange: (s: Step) => void; onDelete: () => void; onUp?: () => void; onDown?: () => void }) {
  const tools = (
    <div className="flex items-center gap-1">
      {onUp && <button type="button" onClick={onUp} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-ink" aria-label="Move up"><ArrowUp size={14} /></button>}
      {onDown && <button type="button" onClick={onDown} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-ink" aria-label="Move down"><ArrowDown size={14} /></button>}
      <button type="button" onClick={onDelete} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete step"><Trash2 size={14} /></button>
    </div>
  );
  if (step.type === "wait") {
    return (
      <Block icon={<Clock size={14} />} tone="bg-amber-500" label="WAIT" title="Pause before the next step" actions={tools}>
        <div className="flex items-center gap-2">
          <input type="number" min={1} value={step.amount} onChange={(e) => onChange({ ...step, amount: Math.max(1, Number(e.target.value)) })} className="input w-24" />
          <select value={step.unit} onChange={(e) => onChange({ ...step, unit: e.target.value as "minutes" })} className="input w-32"><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select>
          <span className="text-xs text-muted">Records are re-checked after the wait, so later conditions see fresh data.</span>
        </div>
      </Block>
    );
  }
  if (step.type === "condition") {
    return (
      <Block icon={<GitBranch size={14} />} tone="bg-sky-600" label="IF" title="Branch on a condition" actions={tools}>
        <div className="mb-3 flex items-center gap-2 text-sm">Match
          <select value={step.match ?? "all"} onChange={(e) => onChange({ ...step, match: e.target.value as "all" })} className="input w-28 py-1"><option value="all">all</option><option value="any">any</option></select> of:
        </div>
        <Conditions conds={step.conditions} fields={opts.fields} onChange={(conditions) => onChange({ ...step, conditions })} />
        <div className="mt-4 space-y-3 border-l-2 border-sky-200 pl-3 sm:pl-4">
          <div className="rounded-xl border border-green-200 bg-green-50/40 p-3"><div className="mb-2 text-xs font-bold tracking-wide text-green-800">THEN — condition met</div><StepList nested steps={step.then} opts={opts} onChange={(then) => onChange({ ...step, then })} /></div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="mb-2 text-xs font-bold tracking-wide text-gray-600">ELSE — otherwise</div><StepList nested steps={step.else} opts={opts} onChange={(e) => onChange({ ...step, else: e })} /></div>
        </div>
      </Block>
    );
  }
  const groups = [...new Set(opts.actions.map((a) => a.group))];
  const set = (patch: Record<string, any>) => onChange({ ...step, config: { ...step.config, ...patch } });
  const c = step.config;
  const isAi = step.action.startsWith("ai_");
  return (
    <Block icon={isAi ? <Sparkles size={14} /> : <Zap size={14} />} tone={isAi ? "bg-fuchsia-600" : "bg-brand-500"} label="THEN" title={opts.actions.find((a) => a.key === step.action)?.label ?? step.action} actions={tools}>
      <div className="space-y-3">
        <select value={step.action} onChange={(e) => onChange({ ...step, action: e.target.value as ActionType, config: defaultConfig(e.target.value as ActionType) })} className="input max-w-sm">
          {groups.map((g) => <optgroup key={g} label={g}>{opts.actions.filter((a) => a.group === g).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</optgroup>)}
        </select>
        <ActionConfig action={step.action} c={c} set={set} opts={opts} />
      </div>
    </Block>
  );
}

function Recipient({ value, onChange, opts, label = "Who" }: { value: string; onChange: (v: string) => void; opts: Opts; label?: string }) {
  return (
    <label className="block"><span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        <option value="owner">Record owner</option><option value="manager">Owner's manager</option>
        <optgroup label="Everyone with role">{opts.roles.map((r) => <option key={r.key} value={`role:${r.key}`}>{r.name}</option>)}</optgroup>
        <optgroup label="Specific person">{opts.members.map((m) => <option key={m.id} value={`member:${m.id}`}>{m.name}</option>)}</optgroup>
      </select>
    </label>
  );
}

function ActionConfig({ action, c, set, opts }: { action: ActionType; c: Record<string, any>; set: (p: Record<string, any>) => void; opts: Opts }) {
  const g = "grid gap-3 md:grid-cols-3";
  switch (action) {
    case "send_message": {
      const tpls = opts.templates.filter((t) => t.channel === c.channel);
      return (
        <div className="space-y-3">
          <div className={g}>
            <label className="block"><span className="label">Channel</span><select value={c.channel} onChange={(e) => set({ channel: e.target.value, templateId: "" })} className="input"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></select></label>
            <label className="block"><span className="label">Send to</span><select value={c.to ?? "customer"} onChange={(e) => set({ to: e.target.value })} className="input"><option value="customer">Customer / lead</option><option value="owner">Record owner (in-app)</option></select></label>
            <label className="block"><span className="label">Template</span><select value={c.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value })} className="input"><option value="">Custom message ↓</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          </div>
          {!c.templateId && (<>
            {c.channel === "email" && <input value={c.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} placeholder="Subject" className="input" />}
            <textarea value={c.body ?? ""} onChange={(e) => set({ body: e.target.value })} rows={3} placeholder="Message — use {{variables}}" className="input" required />
          </>)}
          <p className="text-xs text-muted">WhatsApp / SMS are never sent to numbers on your DND list or customers who opted out.</p>
        </div>
      );
    }
    case "notify":
      return <div className={g}><Recipient value={c.to ?? "owner"} onChange={(v) => set({ to: v })} opts={opts} /><label className="block"><span className="label">Title</span><input value={c.title ?? ""} onChange={(e) => set({ title: e.target.value })} className="input" /></label><label className="block"><span className="label">Message</span><input value={c.body ?? ""} onChange={(e) => set({ body: e.target.value })} className="input" /></label></div>;
    case "create_task":
      return <div className="grid gap-3 md:grid-cols-4"><label className="block md:col-span-2"><span className="label">Task title</span><input value={c.title ?? ""} onChange={(e) => set({ title: e.target.value })} className="input" required /></label><Recipient label="Assign to" value={c.assignTo ?? "owner"} onChange={(v) => set({ assignTo: v })} opts={opts} /><label className="block"><span className="label">Due in (hours)</span><input type="number" min={0.25} step="0.25" value={c.dueInHours ?? 24} onChange={(e) => set({ dueInHours: Number(e.target.value) })} className="input" /></label>
        <label className="block"><span className="label">Priority</span><select value={c.priority ?? "medium"} onChange={(e) => set({ priority: e.target.value })} className="input"><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></label></div>;
    case "create_followup":
      return <div className={g}><label className="block"><span className="label">In (hours)</span><input type="number" min={0.25} step="0.25" value={c.inHours ?? 2} onChange={(e) => set({ inHours: Number(e.target.value) })} className="input" /></label><Recipient label="Assign to" value={c.assignTo ?? "owner"} onChange={(v) => set({ assignTo: v })} opts={opts} /><label className="block"><span className="label">Note</span><input value={c.note ?? ""} onChange={(e) => set({ note: e.target.value })} className="input" /></label></div>;
    case "update_lead":
      return <div className={g}><label className="block"><span className="label">Field</span><select value={c.field} onChange={(e) => set({ field: e.target.value, value: e.target.value === "priority" ? "high" : "contacted" })} className="input"><option value="status">Status</option><option value="priority">Priority</option></select></label>
        <label className="block"><span className="label">Value</span><select value={c.value} onChange={(e) => set({ value: e.target.value })} className="input">{(c.field === "priority" ? ["low", "medium", "high", "urgent"] : ["new", "contacted", "qualified", "unqualified", "lost"]).map((v) => <option key={v}>{v}</option>)}</select></label></div>;
    case "add_tag":
      return <input value={c.tag ?? ""} onChange={(e) => set({ tag: e.target.value })} placeholder="tag" className="input max-w-xs" required />;
    case "assign_lead":
      return <div className={g}><label className="block"><span className="label">How</span><select value={c.mode} onChange={(e) => set({ mode: e.target.value })} className="input"><option value="rules">Run assignment rules again</option><option value="member">Specific person</option></select></label>
        {c.mode === "member" && <label className="block"><span className="label">Person</span><select value={c.memberId ?? ""} onChange={(e) => set({ memberId: e.target.value })} className="input" required><option value="">Choose…</option>{opts.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}</div>;
    case "escalate":
      return <input value={c.note ?? ""} onChange={(e) => set({ note: e.target.value })} placeholder="Escalation note for the manager" className="input" />;
    case "update_ticket":
      return <div className={g}><label className="block"><span className="label">Priority</span><select value={c.priority ?? ""} onChange={(e) => set({ priority: e.target.value })} className="input"><option value="">(unchanged)</option><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></label>
        <label className="block"><span className="label">Status</span><select value={c.status ?? ""} onChange={(e) => set({ status: e.target.value })} className="input"><option value="">(unchanged)</option><option value="open">open</option><option value="in_progress">in progress</option><option value="resolved">resolved</option><option value="closed">closed</option></select></label></div>;
    case "webhook":
      return <input value={c.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://hooks.example.com/…" className="input" required pattern="https://.*" />;
    case "send_digest":
      return <div className={g}><Recipient label="Send to" value={c.to ?? "role:admin"} onChange={(v) => set({ to: v })} opts={opts} /><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={!!c.email} onChange={(e) => set({ email: e.target.checked })} /> Also email it</label></div>;
    case "ai_qualify_lead":
      return <p className="text-sm text-muted">Claude writes a qualification note (intent, questions to ask, objections) and a suggested first message on the lead timeline. Needs <code>ANTHROPIC_API_KEY</code>; skipped otherwise.</p>;
    case "ai_triage_ticket":
      return <p className="text-sm text-muted">Claude sets the ticket category and priority, detects sentiment and drafts a reply for the agent to review. Needs <code>ANTHROPIC_API_KEY</code>.</p>;
    case "stop":
      return <p className="text-sm text-muted">Ends this run here.</p>;
    default:
      return null;
  }
}
