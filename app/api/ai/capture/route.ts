import { authorize, scopeWhere } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { aiEnabled, aiErrorMessage, aiQuickCapture, aiQuotaOk } from "@/lib/ai";
import { normalizePhone } from "@/lib/utils";

export const maxDuration = 60;

/** Voice/Text-to-CRM step 1: parse the note and find matching records. Nothing is written yet. */
export const POST = handle(async (req: Request) => {
  const ctx = await authorize("lead.view", { mod: "ai", write: false });
  if (!aiEnabled()) return jsonError("AI_DISABLED", "AI is not configured.", 503);
  if (!(await aiQuotaOk(ctx))) return jsonError("AI_QUOTA", "Monthly AI limit reached.", 429);
  const { text } = await req.json();
  if (!text || String(text).length > 2000) return jsonError("VALIDATION", "Say or type a note (max 2000 chars)", 422);
  try {
    const c = await aiQuickCapture(ctx, String(text));
    if (!c) return jsonError("AI_ERROR", "Couldn't understand that note — try rephrasing.", 422);
    const phone = normalizePhone(c.phone);
    const scope = await scopeWhere(ctx, "lead.view");
    const lead = phone ? await ctx.db.lead.findFirst({ where: { ...scope, phone, deletedAt: null } })
      : c.customer_name ? await ctx.db.lead.findFirst({ where: { ...scope, deletedAt: null, name: { contains: c.customer_name, mode: "insensitive" } }, orderBy: { updatedAt: "desc" } }) : null;
    const products = c.products.length ? await ctx.db.product.findMany({ where: { OR: c.products.map((p) => ({ name: { contains: p.name.split(" ")[0], mode: "insensitive" as const } })) }, select: { id: true, name: true } }) : [];
    return json({ capture: c, match: lead ? { id: lead.id, name: lead.name, number: lead.number } : null, products });
  } catch (e) {
    return jsonError("AI_ERROR", aiErrorMessage(e), 502);
  }
});
