import Link from "next/link";
import { guard, has } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, Empty, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveProject } from "../tasks/actions";
import { inrCompact } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Projects" };

export default async function Projects() {
  const ctx = await guard("task.view", "projects");
  const [projects, contacts, members] = await Promise.all([
    ctx.db.project.findMany({ orderBy: [{ status: "asc" }, { dueDate: "asc" }], include: { tasks: { select: { status: true, loggedMinutes: true, dueAt: true } } } }),
    ctx.db.contact.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }),
  ]);
  const cname = (id: string | null) => contacts.find((c) => c.id === id)?.name;
  return (
    <>
      <PageHeader title="Projects" subtitle="Customer → project → milestones/tasks → time logged → invoice (BRD §41)." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-4 md:grid-cols-2">
          {projects.length ? projects.map((p) => {
            const done = p.tasks.filter((t) => t.status === "done").length, total = p.tasks.length;
            const hours = p.tasks.reduce((a, t) => a + t.loggedMinutes, 0) / 60;
            const late = p.tasks.filter((t) => t.status !== "done" && t.dueAt && t.dueAt < new Date()).length;
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2"><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link><StatusBadge status={p.status} /></div>
                <div className="mt-0.5 text-xs text-muted">P-{p.number}{cname(p.contactId) && ` · ${cname(p.contactId)}`}{p.dueDate && ` · due ${fmtDate(p.dueDate)}`}</div>
                <div className="mt-3 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-green-600" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
                <div className="mt-2 flex justify-between text-xs text-muted"><span>{done}/{total} tasks{late ? <span className="text-red-700"> · {late} late</span> : ""}</span><span>{hours.toFixed(1)} h · budget {inrCompact(p.budget)}</span></div>
              </Card>
            );
          }) : <Card className="md:col-span-2"><Empty title="No projects yet" /></Card>}
        </div>
        {has(ctx, "project.manage") && (
          <Card title="New project" className="h-fit">
            <form action={saveProject.bind(null, null)} className="space-y-3">
              <Field label="Name *"><input name="name" required className="input" /></Field>
              <Field label="Customer"><select name="contactId" className="input"><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start"><input name="startDate" type="date" className="input" /></Field><Field label="Due"><input name="dueDate" type="date" className="input" /></Field>
                <Field label="Budget (₹)"><input name="budget" type="number" min={0} className="input" /></Field>
                <Field label="Owner"><select name="ownerId" defaultValue={ctx.membership.id} className="input">{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select></Field>
              </div>
              <Field label="Description"><textarea name="description" rows={2} className="input" /></Field>
              <SubmitButton>Create project</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
