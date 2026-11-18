"use server";
import { guarded } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { authorize, scopeWhere } from "@/lib/auth";
import { nextNumber } from "@/lib/db";
import { notify } from "@/lib/notify";
import { emit } from "@/lib/events";
import { audit } from "@/lib/audit";
import { parseCustom } from "@/lib/custom";
import { optStr, str } from "@/lib/utils";

export async function createTask(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("task.manage", { mod: "projects" });
  const assigneeId = optStr(fd.get("assigneeId")) ?? ctx.membership.id;
  if (assigneeId !== ctx.membership.id && ctx.perms["task.view"] === "own") throw new Error("You can only create tasks for yourself");
  const due = optStr(fd.get("dueAt"));
  const t = await ctx.db.task.create({
    data: {
      tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "task"), title: str(fd.get("title")), description: optStr(fd.get("description")),
      projectId: optStr(fd.get("projectId")), assigneeId, createdById: ctx.membership.id, priority: (str(fd.get("priority")) || "medium") as any,
      dueAt: due ? new Date(due) : null, estimateMins: Number(fd.get("estimateHours") || 0) * 60 || null,
      custom: parseCustom(await ctx.db.customFieldDef.findMany({ where: { entity: "task" } }), fd) as object,
    },
  });
  if (assigneeId !== ctx.membership.id) await notify(ctx.tenant.id, assigneeId, `New task from ${ctx.user.name}: ${t.title}`, t.dueAt ? `Due ${t.dueAt.toLocaleString("en-IN")}` : undefined, `/tasks?id=${t.id}`);
  revalidatePath("/tasks"); revalidatePath("/projects");
});
}

export async function updateTask(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("task.manage");
  const t = await ctx.db.task.findFirst({ where: { id, ...(await scopeWhere(ctx, "task.view", "assigneeId", null)) } });
  if (!t) throw new Error("Task not found");
  const status = str(fd.get("status")) || t.status;
  const log = Number(fd.get("logMinutes") || 0);
  const data: Record<string, unknown> = { status, loggedMinutes: t.loggedMinutes + Math.max(0, Math.min(log, 24 * 60)), completedAt: status === "done" ? t.completedAt ?? new Date() : null };
  if (fd.has("assigneeId")) data.assigneeId = optStr(fd.get("assigneeId"));
  if (fd.has("priority")) data.priority = str(fd.get("priority"));
  await ctx.db.task.update({ where: { id }, data });
  if (status === "done" && t.status !== "done") {
    await emit(ctx.tenant.id, "task.completed", { id, taskId: id, ownerId: t.assigneeId, projectId: t.projectId });
    if (t.createdById && t.createdById !== ctx.membership.id) await notify(ctx.tenant.id, t.createdById, `Task completed: ${t.title}`, `by ${ctx.user.name}`, `/tasks?id=${id}`);
  }
  await audit(ctx, "task.update", "Task", id, { status: t.status }, data);
  revalidatePath("/tasks"); revalidatePath("/projects");
});
}

export async function moveTask(id: string, status: string) {
  return guarded(async () => {
  const fd = new FormData(); fd.set("status", status);
  await updateTask(id, fd);
});
}

export async function saveProject(id: string | null, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("project.manage", { mod: "projects" });
  const data = {
    name: str(fd.get("name")), description: optStr(fd.get("description")), contactId: optStr(fd.get("contactId")), ownerId: optStr(fd.get("ownerId")) ?? ctx.membership.id,
    status: str(fd.get("status")) || "active", budget: BigInt(Math.round(Number(fd.get("budget") || 0) * 100)),
    startDate: optStr(fd.get("startDate")) ? new Date(str(fd.get("startDate"))) : null, dueDate: optStr(fd.get("dueDate")) ? new Date(str(fd.get("dueDate"))) : null,
  };
  if (!data.name) throw new Error("Name is required");
  if (id) await ctx.db.project.update({ where: { id }, data });
  else await ctx.db.project.create({ data: { ...data, tenantId: ctx.tenant.id, number: await nextNumber(ctx.tenant.id, "project") } });
  revalidatePath("/projects");
});
}
