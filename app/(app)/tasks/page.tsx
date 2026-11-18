import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, Field, Stat, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CustomFieldInputs, CustomFieldList } from "@/components/CustomFields";
import { TaskBoard } from "./Board";
import { createTask, updateTask } from "./actions";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Tasks" };

export default async function Tasks({ searchParams }: { searchParams: Promise<{ who?: string; project?: string; id?: string; done?: string }> }) {
  const ctx = await guard("task.view", "projects");
  const sp = await searchParams;
  const scope = await scopeWhere(ctx, "task.view", "assigneeId", null);
  const where: Prisma.TaskWhereInput = { ...(sp.who === "team" ? scope : { assigneeId: ctx.membership.id }), ...(sp.project ? { projectId: sp.project } : {}), ...(sp.done ? {} : { OR: [{ status: { not: "done" } }, { completedAt: { gte: new Date(Date.now() - 7 * 86400_000) } }] }) };
  const [tasks, members, projects, defs, mine] = await Promise.all([
    ctx.db.task.findMany({ where, include: { assignee: { include: { user: true } }, project: true }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 400 }),
    ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }),
    ctx.db.project.findMany({ where: { status: { in: ["planning", "active", "on_hold"] } }, orderBy: { name: "asc" } }),
    ctx.db.customFieldDef.findMany({ where: { entity: "task" }, orderBy: { order: "asc" } }),
    ctx.db.task.groupBy({ by: ["status"], where: { assigneeId: ctx.membership.id }, _count: true }),
  ]);
  const now = new Date();
  const sel = sp.id ? await ctx.db.task.findFirst({ where: { id: sp.id, ...scope }, include: { assignee: { include: { user: true } }, project: true } }) : null;
  const overdue = tasks.filter((t) => t.status !== "done" && t.dueAt && t.dueAt < now).length;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "id" && v) as [string, string][]).toString();
  const canTeam = ctx.perms["task.view"] !== "own";
  return (
    <>
      <PageHeader title="Tasks" subtitle="Drag cards between columns. Workflows and AI can create tasks too."
        actions={canTeam && <div className="flex rounded-lg border border-line bg-white p-0.5 text-sm">
          <Link href={`/tasks?${new URLSearchParams({ ...(sp.project ? { project: sp.project } : {}) })}`} className={`rounded-md px-3 py-1 ${sp.who !== "team" ? "bg-gray-100 font-medium" : ""}`}>My tasks</Link>
          <Link href={`/tasks?${new URLSearchParams({ who: "team", ...(sp.project ? { project: sp.project } : {}) })}`} className={`rounded-md px-3 py-1 ${sp.who === "team" ? "bg-gray-100 font-medium" : ""}`}>Team</Link>
        </div>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="My open tasks" value={mine.filter((m) => m.status !== "done").reduce((a, m) => a + m._count, 0)} />
        <Stat label="Overdue (this view)" value={overdue} tone={overdue ? "bad" : "good"} />
        <Stat label="In review" value={tasks.filter((t) => t.status === "review").length} />
        <Stat label="Done (7 days)" value={tasks.filter((t) => t.status === "done").length} tone="good" />
      </div>
      <form className="mb-4 flex flex-wrap gap-2" action="/tasks">
        {sp.who && <input type="hidden" name="who" value={sp.who} />}
        <select name="project" defaultValue={sp.project ?? ""} className="input w-56"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" name="done" value="1" defaultChecked={!!sp.done} /> Include older done</label>
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="grid gap-6 2xl:grid-cols-[1fr_360px]">
        <TaskBoard qs={qs} tasks={tasks.map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee?.user.name ?? null, due: t.dueAt ? fmtDate(t.dueAt, true) : null, overdue: !!(t.dueAt && t.dueAt < now && t.status !== "done"), project: t.project?.name ?? null, source: t.source }))} />
        <div className="space-y-4">
          {sel ? (
            <Card title={`T-${sel.number} · ${sel.title}`} actions={<Link href={`/tasks?${qs}`} className="text-xs text-muted">Close</Link>}>
              <div className="mb-3 flex flex-wrap gap-2 text-xs"><StatusBadge status={sel.priority} />{sel.project && <Link href={`/projects/${sel.projectId}`} className="link">{sel.project.name}</Link>}{sel.leadId && <Link href={`/leads/${sel.leadId}`} className="link">Lead</Link>}{sel.contactId && <Link href={`/contacts/${sel.contactId}`} className="link">Customer</Link>}</div>
              {sel.description && <p className="mb-3 whitespace-pre-wrap text-sm">{sel.description}</p>}
              <dl className="mb-4 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
                <dt className="text-muted">Assignee</dt><dd>{sel.assignee?.user.name ?? "—"}</dd><dt className="text-muted">Due</dt><dd>{fmtDate(sel.dueAt, true)}</dd>
                <dt className="text-muted">Time logged</dt><dd>{(sel.loggedMinutes / 60).toFixed(1)} h{sel.estimateMins ? ` of ${(sel.estimateMins / 60).toFixed(1)} h est.` : ""}</dd>
                <CustomFieldList defs={defs} values={(sel.custom ?? {}) as Record<string, unknown>} />
              </dl>
              {has(ctx, "task.manage") && (
                <form action={updateTask.bind(null, sel.id)} className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select name="status" defaultValue={sel.status} className="input"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="done">Done</option></select>
                    <input name="logMinutes" type="number" min={0} max={1440} placeholder="Log minutes" className="input" />
                  </div>
                  {canTeam && <select name="assigneeId" defaultValue={sel.assigneeId ?? ""} className="input">{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select>}
                  <SubmitButton className="btn-primary w-full">Update task</SubmitButton>
                </form>
              )}
            </Card>
          ) : has(ctx, "task.manage") && (
            <Card title="New task">
              <form action={createTask} className="space-y-3">
                <Field label="Title *"><input name="title" required className="input" /></Field>
                <Field label="Description"><textarea name="description" rows={2} className="input" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Due"><input name="dueAt" type="datetime-local" className="input" /></Field>
                  <Field label="Priority"><select name="priority" defaultValue="medium" className="input"><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></Field>
                  <Field label="Estimate (h)"><input name="estimateHours" type="number" min={0} step="0.5" className="input" /></Field>
                  <Field label="Project"><select name="projectId" defaultValue={sp.project ?? ""} className="input"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                </div>
                {canTeam && <Field label="Assignee"><select name="assigneeId" defaultValue={ctx.membership.id} className="input">{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select></Field>}
                <div className="grid grid-cols-1 gap-2"><CustomFieldInputs defs={defs} /></div>
                <SubmitButton>Create task</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
