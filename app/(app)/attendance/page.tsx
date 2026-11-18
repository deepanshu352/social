import { guard, has, scopeWhere } from "@/lib/auth";
import { Card, PageHeader, Stat, StatusBadge, Badge } from "@/components/ui";
import { CheckButtons } from "./CheckButtons";
import { tenantToday } from "@/lib/hr";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Attendance" };
const time = (d: Date | null | undefined, tz: string) => (d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—");

export default async function Attendance() {
  const ctx = await guard("hr.self", "hr");
  const tz = ctx.tenant.timezone;
  const today = tenantToday(tz);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [mine, month, teamToday, members, onLeave] = await Promise.all([
    ctx.db.attendanceRecord.findFirst({ where: { membershipId: ctx.membership.id, date: today } }),
    ctx.db.attendanceRecord.findMany({ where: { membershipId: ctx.membership.id, date: { gte: monthStart } }, orderBy: { date: "desc" } }),
    has(ctx, "hr.view") ? ctx.db.attendanceRecord.findMany({ where: { date: today, ...(await scopeWhere(ctx, "hr.view", "membershipId", null)) } }) : [],
    has(ctx, "hr.view") ? ctx.db.membership.findMany({ where: { status: "active", ...(await scopeWhere(ctx, "hr.view", "id", null)) }, include: { user: true, branch: true } }) : [],
    has(ctx, "hr.view") ? ctx.db.leaveRequest.findMany({ where: { status: "approved", fromDate: { lte: today }, toDate: { gte: today } } }) : [],
  ]);
  const state = !mine?.checkIn ? "none" : !mine.checkOut ? "in" : "done";
  const present = month.filter((m) => m.checkIn).length, late = month.filter((m) => m.status === "late").length;
  const hours = month.reduce((a, m) => a + m.minutesWorked, 0) / 60;
  return (
    <>
      <PageHeader title="Attendance" subtitle={`Shift starts ${ctx.tenant.shiftStart} · 15 minutes grace`} />
      <div className="mb-6 grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <div className="text-xs text-muted">{fmtDate(new Date())}</div>
          <div className="mt-1 text-2xl font-semibold">{state === "none" ? "Not checked in" : state === "in" ? `In since ${time(mine?.checkIn, tz)}` : `${(mine!.minutesWorked / 60).toFixed(1)} h today`}</div>
          {mine?.status === "late" && <Badge tone="amber">Late · {mine.note}</Badge>}
          <div className="mt-4"><CheckButtons state={state} /></div>
        </Card>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Days present (month)" value={present} /><Stat label="Late marks" value={late} tone={late >= 3 ? "warn" : undefined} hint={late >= 3 ? "3 late = ½ day CL per policy" : undefined} /><Stat label="Hours worked" value={hours.toFixed(1)} />
        </div>
      </div>
      {members.length > 0 && (
        <Card title={`Team today · ${teamToday.filter((t) => t.checkIn).length}/${members.length} in`} pad={false} className="mb-6">
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Member</th><th>Branch</th><th>Status</th><th>In</th><th>Out</th><th>Location</th></tr></thead>
            <tbody>{members.map((m) => {
              const r = teamToday.find((t) => t.membershipId === m.id);
              const leave = onLeave.find((l) => l.membershipId === m.id);
              return (
                <tr key={m.id}><td className="font-medium">{m.user.name}</td><td>{m.branch?.name ?? "—"}</td>
                  <td>{leave ? <Badge tone="violet">On leave</Badge> : r?.checkIn ? <StatusBadge status={r.status === "late" ? "pending" : "active"} /> : <Badge tone="red">Not in</Badge>}{r?.status === "late" && <span className="ml-1 text-xs text-amber-700">late</span>}</td>
                  <td>{time(r?.checkIn, tz)}</td><td>{time(r?.checkOut, tz)}</td>
                  <td className="text-xs">{r?.checkInLat != null ? <a className="link" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${r.checkInLat},${r.checkInLng}`}>Map</a> : "—"}</td></tr>
              );
            })}</tbody></table></div>
        </Card>
      )}
      <Card title="My attendance this month" pad={false}>
        <table className="table"><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th className="text-right">Hours</th></tr></thead>
          <tbody>{month.map((r) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td><Badge tone={r.status === "late" ? "amber" : r.status === "half_day" ? "violet" : "green"}>{r.status.replace("_", " ")}</Badge></td><td>{time(r.checkIn, tz)}</td><td>{time(r.checkOut, tz)}</td><td className="text-right tabular-nums">{(r.minutesWorked / 60).toFixed(1)}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
