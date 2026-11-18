"use server";
import { guarded } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { decide } from "@/lib/approvals";
import { prisma } from "@/lib/prisma";
import { str } from "@/lib/utils";

/** Decide an approval and, when the chain completes, update the underlying record. */
export async function decideAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("hr.self");
  const { status, request } = await decide(ctx, id, str(fd.get("decision")) === "approve", str(fd.get("comment")));
  if (status !== "pending") {
    const final = status === "approved" ? "approved" : "rejected";
    if (request.entity === "expense") await prisma.expense.updateMany({ where: { id: request.entityId, tenantId: ctx.tenant.id }, data: { status: final } });
    if (request.entity === "leave") await prisma.leaveRequest.updateMany({ where: { id: request.entityId, tenantId: ctx.tenant.id }, data: { status: final } });
    if (request.entity === "purchase_order") await prisma.purchaseOrder.updateMany({ where: { id: request.entityId, tenantId: ctx.tenant.id }, data: { status: status === "approved" ? "approved" : "cancelled" } });
  }
  revalidatePath("/approvals");
});
}
