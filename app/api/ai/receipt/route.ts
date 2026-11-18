import { authorize } from "@/lib/auth";
import { handle, json, jsonError } from "@/lib/api";
import { storeUpload } from "@/lib/files";
import { aiEnabled, aiErrorMessage, aiQuotaOk, aiScanReceipt } from "@/lib/ai";

export const maxDuration = 60;

/** Stores the uploaded receipt and (when AI is configured) extracts expense fields for review. */
export const POST = handle(async (req: Request) => {
  const ctx = await authorize("hr.self", { mod: "hr" });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return jsonError("VALIDATION", "Attach a file", 422);
  const blob = await storeUpload(ctx, file);
  if (!aiEnabled() || !(await aiQuotaOk(ctx))) return json({ fileId: blob.id, extracted: null, note: "Receipt attached. AI scanning is not configured — fill the fields manually." });
  try {
    const extracted = await aiScanReceipt(ctx, { mime: blob.mime, data: Buffer.from(blob.data) });
    return json({ fileId: blob.id, extracted });
  } catch (e) {
    return json({ fileId: blob.id, extracted: null, note: aiErrorMessage(e) });
  }
});
