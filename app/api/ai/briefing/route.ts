import { authorize } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { aiBriefing, aiEnabled, aiErrorMessage, aiQuotaOk } from "@/lib/ai";
import { dashboardMetrics, insightsFrom } from "@/lib/metrics";

export const maxDuration = 60;

export const POST = handle(async () => {
  const ctx = await authorize("ai.use", { mod: "ai", write: false });
  if (!aiEnabled()) return jsonError("AI_DISABLED", "AI is not configured.", 503);
  if (!(await aiQuotaOk(ctx))) return jsonError("AI_QUOTA", "Monthly AI limit reached.", 429);
  const m = await dashboardMetrics(ctx);
  try {
    const text = await aiBriefing(ctx, { ...m, signals: insightsFrom(m).map((i) => i.text), amounts_are: "paise (divide by 100 for INR)" });
    return json({ text });
  } catch (e) {
    return jsonError("AI_ERROR", aiErrorMessage(e), 502);
  }
});
