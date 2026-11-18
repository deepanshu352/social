import { authorize } from "@/lib/auth";
import { handle, json } from "@/lib/api";
import { startCall } from "@/lib/calls";

export const POST = handle(async (req: Request) => {
  const ctx = await authorize("call.make", { mod: "calling" });
  const body = await req.json();
  const call = await startCall(ctx, { leadId: body.leadId, contactId: body.contactId });
  return json({ call }, 201);
});
