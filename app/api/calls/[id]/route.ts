import { authorize } from "@/lib/auth";
import { handle, json } from "@/lib/api";
import { updateCall } from "@/lib/calls";

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await authorize("call.make", { write: false });
  const { id } = await params;
  return json({ call: await ctx.db.callLog.findFirst({ where: { id, agentId: ctx.membership.id } }) });
});

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await authorize("call.make", { mod: "calling" });
  const { id } = await params;
  return json({ call: await updateCall(ctx, id, await req.json()) });
});
