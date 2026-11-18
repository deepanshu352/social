import { authorize } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { aiEnabled, aiErrorMessage, aiKbAnswer, aiQuotaOk } from "@/lib/ai";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const ctx = await authorize("kb.view", { mod: "ai", write: false });
  if (!aiEnabled()) return jsonError("AI_DISABLED", "AI is not configured.", 503);
  if (!(await aiQuotaOk(ctx))) return jsonError("AI_QUOTA", "Monthly AI limit reached.", 429);
  const { question } = await req.json();
  if (!question || String(question).length > 500) return jsonError("VALIDATION", "Ask a question (max 500 chars)", 422);
  try { return json(await aiKbAnswer(ctx, String(question))); } catch (e) { return jsonError("AI_ERROR", aiErrorMessage(e), 502); }
});
