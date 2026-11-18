import { prisma } from "./prisma";

export const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid"] as const;

/** Remaining leave per type for the current calendar year (approved + pending count against the balance). */
export async function leaveBalances(tenantId: string, membershipId: string, policy: Record<string, number>) {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const used = await prisma.leaveRequest.groupBy({ by: ["type"], where: { tenantId, membershipId, status: { in: ["approved", "pending"] }, fromDate: { gte: yearStart } }, _sum: { days: true } });
  const out: Record<string, { allowed: number; used: number; left: number }> = {};
  for (const t of LEAVE_TYPES) {
    const allowed = t === "unpaid" ? 365 : Number(policy?.[t] ?? 0);
    const u = used.find((x) => x.type === t)?._sum.days ?? 0;
    out[t] = { allowed, used: u, left: Math.max(0, allowed - u) };
  }
  return out;
}

/** Working days between two dates inclusive (Mon–Sat; Sunday off — typical Indian SMB). */
export function workingDays(from: Date, to: Date) {
  let n = 0;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++;
  return n;
}

/** Today's date in the tenant timezone as a UTC-midnight Date (matches @db.Date columns). */
export function tenantToday(tz: string) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${s}T00:00:00.000Z`);
}

export function minutesLate(checkIn: Date, shiftStart: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(checkIn);
  const mins = (Number(parts.find((p) => p.type === "hour")!.value) % 24) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
  const [h, m] = shiftStart.split(":").map(Number);
  return mins - (h * 60 + (m || 0));
}

/** Haversine distance in metres — used to flag check-ins far from the branch. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
