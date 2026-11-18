import { authorize } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { aiEnabled, aiErrorMessage, aiQuotaOk, runCopilot, type ChatTurn } from "@/lib/ai";

export const maxDuration = 120;

export const POST = handle(async (req: Request) => {
  const ctx = await authorize("ai.use", { mod: "ai", write: false });
  if (!aiEnabled()) return jsonError("AI_DISABLED", "AI is not configured. Set ANTHROPIC_API_KEY on the server.", 503);
  if (!(await aiQuotaOk(ctx))) return jsonError("AI_QUOTA", "Monthly AI request limit reached for your plan.", 429);
  const { messages } = (await req.json()) as { messages: ChatTurn[] };
  if (!Array.isArray(messages) || !messages.length || messages.at(-1)?.role !== "user") return jsonError("BAD_REQUEST", "messages must end with a user turn");
  const clean = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  try {
    return json({ reply: await runCopilot(ctx, clean) });
  } catch (e) {
    console.error(e);
    return jsonError("AI_ERROR", aiErrorMessage(e), 502);
  }
});
