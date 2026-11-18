import crypto from "node:crypto";
import { prisma } from "./prisma";
import type { Tenant } from "@prisma/client";

/**
 * Telephony provider abstraction (BRD §16). Ship with MockProvider (demo/trial/dev);
 * add Exotel / Knowlarity / Ozonetel / Twilio adapters by implementing this interface.
 * Real providers call back POST /api/webhooks/telephony with status updates.
 */
export interface TelephonyProvider {
  name: string;
  placeCall(p: { agentNumber: string; customerNumber: string; callerId?: string; record: boolean }): Promise<{ providerCallId: string }>;
}

export const mockProvider: TelephonyProvider = {
  name: "mock",
  async placeCall() {
    return { providerCallId: `mock_${crypto.randomUUID()}` };
  },
};

export function getProvider(): TelephonyProvider {
  // switch (process.env.TELEPHONY_PROVIDER) { case "exotel": return exotelProvider; }
  return mockProvider;
}

export const DISPOSITIONS: { key: string; label: string; category: "positive" | "negative" | "not_connected" | "invalid"; leadStatus?: string; callback?: boolean; dnd?: boolean }[] = [
  { key: "interested", label: "Interested", category: "positive", leadStatus: "qualified" },
  { key: "follow_up", label: "Follow-up Required", category: "positive", leadStatus: "contacted", callback: true },
  { key: "call_back", label: "Call Back", category: "not_connected", leadStatus: "contacted", callback: true },
  { key: "converted", label: "Converted", category: "positive", leadStatus: "converted" },
  { key: "not_interested", label: "Not Interested", category: "negative", leadStatus: "lost" },
  { key: "do_not_call", label: "Do Not Call (opt-out)", category: "negative", leadStatus: "lost", dnd: true },
  { key: "busy", label: "Busy", category: "not_connected", callback: true },
  { key: "no_answer", label: "No Answer", category: "not_connected", callback: true },
  { key: "wrong_number", label: "Wrong Number", category: "invalid", leadStatus: "unqualified" },
];
export const dispositionLabel = (k?: string | null) => DISPOSITIONS.find((d) => d.key === k)?.label ?? k ?? "—";

/** Minutes since midnight in the tenant's timezone. */
function localMinutes(tz: string, d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };

/** Compliance gates enforced server-side before every call (BRD §18). */
export async function complianceCheck(tenant: Tenant, phone: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const dnd = await prisma.dndNumber.findUnique({ where: { tenantId_phone: { tenantId: tenant.id, phone } } });
  if (dnd) return { ok: false, code: "CALL_BLOCKED_DND", message: "This number is on your Do-Not-Call list." };
  const contact = await prisma.contact.findFirst({ where: { tenantId: tenant.id, phone, dnd: true } });
  if (contact) return { ok: false, code: "CALL_BLOCKED_DND", message: "Customer has opted out of calls." };
  const now = localMinutes(tenant.timezone);
  if (process.env.IGNORE_CALLING_HOURS !== "1" && (now < toMin(tenant.callingStart) || now > toMin(tenant.callingEnd))) {
    return { ok: false, code: "CALL_BLOCKED_HOURS", message: `Calls are allowed only between ${tenant.callingStart} and ${tenant.callingEnd} (${tenant.timezone}).` };
  }
  return { ok: true };
}
