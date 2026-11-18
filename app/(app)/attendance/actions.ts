"use server";
import { guarded } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { minutesLate, tenantToday } from "@/lib/hr";
import { audit } from "@/lib/audit";

const coord = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function checkIn(loc: { lat?: number; lng?: number } | null) {
  return guarded(async () => {
  const ctx = await authorize("hr.self", { mod: "hr" });
  const date = tenantToday(ctx.tenant.timezone);
  const existing = await ctx.db.attendanceRecord.findFirst({ where: { membershipId: ctx.membership.id, date } });
  if (existing?.checkIn) throw new Error("Already checked in today");
  const now = new Date();
  const late = minutesLate(now, ctx.tenant.shiftStart, ctx.tenant.timezone);
  const data = { checkIn: now, checkInLat: coord(loc?.lat), checkInLng: coord(loc?.lng), status: late > 15 ? "late" : "present", note: late > 15 ? `${late} min late` : null };
  if (existing) await ctx.db.attendanceRecord.update({ where: { id: existing.id }, data });
  else await ctx.db.attendanceRecord.create({ data: { ...data, tenantId: ctx.tenant.id, membershipId: ctx.membership.id, date } });
  await audit(ctx, "attendance.check_in", "AttendanceRecord", null, null, { at: now, lat: data.checkInLat, lng: data.checkInLng });
  revalidatePath("/attendance");
});
}

export async function checkOut(loc: { lat?: number; lng?: number } | null) {
  return guarded(async () => {
  const ctx = await authorize("hr.self", { mod: "hr" });
  const date = tenantToday(ctx.tenant.timezone);
  const r = await ctx.db.attendanceRecord.findFirst({ where: { membershipId: ctx.membership.id, date } });
  if (!r?.checkIn) throw new Error("Check in first");
  if (r.checkOut) throw new Error("Already checked out");
  const now = new Date();
  const mins = Math.round((now.getTime() - r.checkIn.getTime()) / 60000);
  await ctx.db.attendanceRecord.update({ where: { id: r.id }, data: { checkOut: now, checkOutLat: coord(loc?.lat), checkOutLng: coord(loc?.lng), minutesWorked: mins, status: mins < 240 ? "half_day" : r.status } });
  revalidatePath("/attendance");
});
}
