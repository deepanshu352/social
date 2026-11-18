import { authorize } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { aiDraftMessage, aiEnabled, aiErrorMessage, aiQuotaOk } from "@/lib/ai";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const ctx = await authorize("ai.use", { mod: "ai", write: false });
  if (!aiEnabled()) return jsonError("AI_DISABLED", "AI is not configured.", 503);
  if (!(await aiQuotaOk(ctx))) return jsonError("AI_QUOTA", "Monthly AI limit reached.", 429);
  const b = await req.json();
  try {
    const text = await aiDraftMessage(ctx, { channel: String(b.channel ?? "whatsapp"), purpose: String(b.purpose ?? "follow up").slice(0, 500), leadId: b.leadId, contactId: b.contactId });
    const m = text.match(/^Subject:\s*(.+)\n+([\s\S]*)$/i);
    return json(m ? { subject: m[1].trim(), body: m[2].trim() } : { body: text });
  } catch (e) {
    return jsonError("AI_ERROR", aiErrorMessage(e), 502);
  }
});
