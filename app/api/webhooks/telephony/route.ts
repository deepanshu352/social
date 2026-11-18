import { prisma } from "@/lib/prisma";
import { jsonError, json } from "@/lib/api";

/**
 * Generic telephony status webhook. Map your provider's payload to:
 * { providerCallId, status: ringing|in_progress|completed|no_answer|busy|failed, talkSeconds?, recordingUrl? }
 * Authenticated with the X-Webhook-Secret header. Idempotent on providerCallId + status.
 */
export async function POST(req: Request) {
  if (req.headers.get("x-webhook-secret") !== process.env.TELEPHONY_WEBHOOK_SECRET) return jsonError("UNAUTHORIZED", "Bad secret", 401);
  const b = await req.json().catch(() => null);
  if (!b?.providerCallId) return jsonError("BAD_REQUEST", "providerCallId required");
  const call = await prisma.callLog.findUnique({ where: { providerCallId: String(b.providerCallId) } });
  if (!call) return jsonError("NOT_FOUND", "Unknown call", 404);
  const status = ["ringing", "in_progress", "completed", "no_answer", "busy", "failed"].includes(b.status) ? b.status : call.status;
  const updated = await prisma.callLog.update({
    where: { id: call.id },
    data: {
      status,
      answeredAt: status === "in_progress" && !call.answeredAt ? new Date() : undefined,
      endedAt: ["completed", "no_answer", "busy", "failed"].includes(status) ? call.endedAt ?? new Date() : undefined,
      talkSeconds: typeof b.talkSeconds === "number" ? b.talkSeconds : undefined,
      recordingUrl: typeof b.recordingUrl === "string" ? b.recordingUrl : undefined,
    },
  });
  return json({ ok: true, status: updated.status });
}
