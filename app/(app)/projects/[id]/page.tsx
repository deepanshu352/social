import Link from "next/link";
import { notFound } from "next/navigation";
import { guard, has } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Stat, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveProject, createTask } from "../../tasks/actions";
import { inrCompact } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await guard("task.view", "projects");
  const p = await ctx.db.project.findFirst({ where: { id }, include: { tasks: { include: { assignee: { include: { user: true } } }, orderBy: [{ status: "asc" }, { dueAt: "asc" }] } } });
  if (!p) notFound();
  const [members, contact] = await Promise.all([ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }), p.contactId ? ctx.db.contact.findFirst({ where: { id: p.contactId } }) : null]);
  const done = p.tasks.filter((t) => t.status === "done").length;
  const hours = p.tasks.reduce((a, t) => a + t.loggedMinutes, 0) / 60;
  const est = p.tasks.reduce((a, t) => a + (t.estimateMins ?? 0), 0) / 60;
  return (
    <>
      <PageHeader back={{ href: "/projects", label: "Projects" }} title={<span className="flex items-center gap-2">{p.name} <StatusBadge status={p.status} /></span>}
        subtitle={<>P-{p.number}{contact && <> · <Link href={`/contacts/${contact.id}`} className="link">{contact.name}</Link></>}{p.dueDate && ` · due ${fmtDate(p.dueDate)}`}</>}
        actions={<Link href={`/tasks?project=${p.id}&who=team`} className="btn-secondary">Open task board</Link>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Progress" value={`${p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0}%`} hint={`${done} of ${p.tasks.length} tasks`} />
        <Stat label="Time logged" value={`${hours.toFixed(1)} h`} hint={est ? `${est.toFixed(1)} h estimated` : undefined} tone={est && hours > est ? "warn" : undefined} />
        <Stat label="Budget" value={inrCompact(p.budget)} />
        <Stat label="Overdue tasks" value={p.tasks.filter((t) => t.status !== "done" && t.dueAt && t.dueAt < new Date()).length} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card title="Tasks" pad={false}>
          <table className="table"><thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Status</th><th className="text-right">Hours</th></tr></thead>
            <tbody>{p.tasks.map((t) => <tr key={t.id}><td><Link href={`/tasks?project=${p.id}&who=team&id=${t.id}`} className="hover:underline">{t.title}</Link></td><td>{t.assignee?.user.name ?? "—"}</td><td className={t.status !== "done" && t.dueAt && t.dueAt < new Date() ? "text-red-700" : ""}>{fmtDate(t.dueAt)}</td><td><StatusBadge status={t.status === "done" ? "done" : t.status === "todo" ? "open" : "in_progress"} /></td><td className="text-right tabular-nums">{(t.loggedMinutes / 60).toFixed(1)}</td></tr>)}</tbody>
          </table>
          {has(ctx, "task.manage") && (
            <form action={createTask} className="flex flex-wrap gap-2 border-t border-line p-4">
              <input type="hidden" name="projectId" value={p.id} />
              <input name="title" required placeholder="New task / milestone" className="input min-w-48 flex-1" />
              <select name="assigneeId" className="input w-40">{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select>
              <input name="dueAt" type="datetime-local" className="input w-52" />
              <SubmitButton>Add</SubmitButton>
            </form>
          )}
        </Card>
        {has(ctx, "project.manage") && (
          <Card title="Project settings" className="h-fit">
            <form action={saveProject.bind(null, p.id)} className="space-y-3">
              <Field label="Name"><input name="name" defaultValue={p.name} className="input" /></Field>
              <input type="hidden" name="contactId" value={p.contactId ?? ""} /><input type="hidden" name="ownerId" value={p.ownerId ?? ""} />
              <Field label="Status"><select name="status" defaultValue={p.status} className="input">{["planning", "active", "on_hold", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Start"><input name="startDate" type="date" defaultValue={p.startDate?.toISOString().slice(0, 10)} className="input" /></Field><Field label="Due"><input name="dueDate" type="date" defaultValue={p.dueDate?.toISOString().slice(0, 10)} className="input" /></Field></div>
              <Field label="Budget (₹)"><input name="budget" type="number" defaultValue={Number(p.budget) / 100} className="input" /></Field>
              <Field label="Description"><textarea name="description" rows={3} defaultValue={p.description ?? ""} className="input" /></Field>
              <SubmitButton>Save</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
