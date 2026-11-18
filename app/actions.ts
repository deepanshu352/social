"use server";
import { guarded } from "@/lib/action";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { destroySession, getCtx, getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function logout() {
  return guarded(async () => {
  await destroySession();
  redirect("/login");
});
}

export async function markAllRead() {
  return guarded(async () => {
  const ctx = await getCtx();
  if (!ctx) return;
  await ctx.db.notification.updateMany({ where: { membershipId: ctx.membership.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
});
}

export async function switchTenant(fd: FormData) {
  return guarded(async () => {
  const s = await getSessionUser();
  const tenantId = String(fd.get("tenantId"));
  if (!s) redirect("/login");
  const m = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: s.userId } } });
  if (!m || m.status !== "active") throw new Error("No access to that workspace");
  await prisma.session.update({ where: { id: s.id }, data: { tenantId } });
  redirect("/dashboard");
});
}
