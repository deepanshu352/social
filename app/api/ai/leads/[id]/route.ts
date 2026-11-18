import { authorize } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { aiEnabled, aiErrorMessage, aiLeadInsight, aiQuotaOk } from "@/lib/ai";

export const maxDuration = 60;

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await authorize("ai.use", { mod: "ai", write: false });
  if (!aiEnabled()) return jsonError("AI_DISABLED", "AI is not configured.", 503);
  if (!(await aiQuotaOk(ctx))) return jsonError("AI_QUOTA", "Monthly AI limit reached.", 429);
  const { id } = await params;
  try {
    return json({ text: await aiLeadInsight(ctx, id) });
  } catch (e) {
    return jsonError("AI_ERROR", aiErrorMessage(e), 502);
  }
});
