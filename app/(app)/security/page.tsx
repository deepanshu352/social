import { revalidatePath } from "next/cache";
import { ShieldCheck, ShieldAlert, AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { authorize, guard, clientIp } from "@/lib/auth";
import { Card, PageHeader, Stat, Badge, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { prisma } from "@/lib/prisma";
import { securityFindings } from "@/lib/anomalies";
import { audit, verifyAuditChain } from "@/lib/audit";
import { ipAllowed } from "@/lib/security";
import { fmtDate, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Security center" };
const ICON = { info: Info, warning: AlertTriangle, critical: OctagonAlert };
const TONE = { info: "text-brand-600", warning: "text-amber-600", critical: "text-red-600" };

async function savePolicy(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("security.manage");
  const allow = str(fd.get("ipAllowlist")).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  for (const a of allow) if (!/^[\d.:a-f]+(\/\d{1,2})?$/i.test(a)) throw new Error(`Invalid IP / CIDR: ${a}`);
  if (allow.length && !ipAllowed(await clientIp(), allow)) throw new Error(`Your current IP (${await clientIp()}) isn't in the list — you would lock yourself out.`);
  const data = {
    require2fa: ["none", "admins", "all"].includes(str(fd.get("require2fa"))) ? str(fd.get("require2fa")) : "none",
    ipAllowlist: allow, sessionIdleMins: Math.min(1440 * 7, Math.max(15, Number(fd.get("sessionIdleMins")) || 720)), maskPhones: fd.get("maskPhones") === "on",
  };
  const before = { require2fa: ctx.tenant.require2fa, ipAllowlist: ctx.tenant.ipAllowlist, sessionIdleMins: ctx.tenant.sessionIdleMins, maskPhones: ctx.tenant.maskPhones };
  await prisma.tenant.update({ where: { id: ctx.tenant.id }, data });
  await audit(ctx, "security.policy", "Tenant", ctx.tenant.id, before, data);
  revalidatePath("/security");
});
}
async function signOutEveryone() {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("security.manage");
  const r = await prisma.session.updateMany({ where: { tenantId: ctx.tenant.id, revokedAt: null, NOT: { id: ctx.sessionId } }, data: { revokedAt: new Date() } });
  await audit(ctx, "security.revoke_all_sessions", "Tenant", ctx.tenant.id, null, { sessions: r.count });
  revalidatePath("/security");
});
}
async function unlockUser(userId: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("security.manage");
  const m = await ctx.db.membership.findFirst({ where: { userId } });
  if (!m) throw new Error("Not a member");
  await prisma.user.update({ where: { id: userId }, data: { lockedUntil: null, failedLogins: 0 } });
  await audit(ctx, "security.unlock_user", "User", userId);
  revalidatePath("/security");
});
}

export default async function Security({ searchParams }: { searchParams: Promise<{ verify?: string }> }) {
  const ctx = await guard("security.manage");
  const sp = await searchParams;
  const t = ctx.tenant;
  const members = await ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true, role: true } });
  const userIds = members.map((m) => m.userId);
  const [findings, sessions, events, keys, chain] = await Promise.all([
    securityFindings(t.id, t.timezone),
    prisma.session.count({ where: { tenantId: t.id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.loginEvent.findMany({ where: { OR: [{ tenantId: t.id }, { userId: { in: userIds } }] }, orderBy: { createdAt: "desc" }, take: 25 }),
    ctx.db.apiKey.count({ where: { revokedAt: null } }),
    sp.verify ? verifyAuditChain(t.id) : null,
  ]);
  const with2fa = members.filter((m) => m.user.totpEnabled).length;
  const locked = members.filter((m) => m.user.lockedUntil && m.user.lockedUntil > new Date());
  let score = 100;
  if (members.some((m) => ["admin", "branch_admin"].includes(m.role.key) && !m.user.totpEnabled)) score -= 20;
  if (with2fa / Math.max(1, members.length) < 0.5) score -= 10;
  if (!t.maskPhones) score -= 5;
  if (t.sessionIdleMins > 720) score -= 5;
  if (!t.ipAllowlist.length) score -= 5;
  score -= Math.min(30, findings.filter((f) => f.severity === "critical").length * 10);
  if (chain && !chain.ok) score -= 30;
  score = Math.max(0, score);
  const grade = score >= 85 ? ["Strong", "text-green-700"] : score >= 65 ? ["Fair", "text-amber-700"] : ["At risk", "text-red-700"];

  return (
    <>
      <PageHeader title="Security center" subtitle="Posture, policies, suspicious activity and a tamper-evident audit trail."
        actions={<><a href="/api/export" className="btn-secondary">Export all company data</a><form action={signOutEveryone}><SubmitButton className="btn-danger" confirm="Sign out every user in your company (except you)?">Sign out everyone</SubmitButton></form></>} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="card card-pad col-span-2 flex items-center gap-4 lg:col-span-1">
          {score >= 85 ? <ShieldCheck className="text-green-600" size={40} /> : <ShieldAlert className="text-amber-600" size={40} />}
          <div><div className="text-3xl font-semibold tabular-nums">{score}</div><div className={`text-sm font-medium ${grade[1]}`}>{grade[0]}</div></div>
        </div>
        <Stat label="2FA adoption" value={`${with2fa}/${members.length}`} hint={`${Math.round((with2fa / Math.max(1, members.length)) * 100)}% of users`} tone={with2fa === members.length ? "good" : "warn"} />
        <Stat label="Active sessions" value={sessions} />
        <Stat label="Findings (7 days)" value={findings.length} tone={findings.some((f) => f.severity === "critical") ? "bad" : findings.length ? "warn" : "good"} />
        <Stat label="Active API keys" value={keys} href="/settings/api" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card title="Suspicious activity & risks">
            {findings.length ? <ul className="space-y-3">{findings.map((f, i) => {
              const Icon = ICON[f.severity];
              return <li key={i} className="flex gap-3 text-sm"><Icon size={17} className={`mt-0.5 shrink-0 ${TONE[f.severity]}`} aria-label={f.severity} /><div className="flex-1"><div className="font-medium">{f.title}</div><div className="text-muted">{f.detail}</div></div>{f.href && <a href={f.href} className="link shrink-0 text-xs">Review</a>}</li>;
            })}</ul> : <p className="text-sm text-muted">No suspicious activity detected in the last 7 days.</p>}
          </Card>
          <Card title="Audit trail integrity">
            <p className="text-sm text-muted">Every audit entry is hash-chained to the previous one (SHA-256). Editing or deleting any past entry breaks the chain.</p>
            {chain && (chain.ok
              ? <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">✓ Verified {chain.checked.toLocaleString("en-IN")} entries — no tampering detected.</p>
              : <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">✗ Chain broken at entry {chain.brokenAt} ({chain.action}, {fmtDate(chain.at, true)}). History may have been altered.</p>)}
            <a href="/security?verify=1" className="btn-secondary mt-3">Verify audit chain now</a>
          </Card>
          <Card title="Recent sign-ins" pad={false}>
            <div className="overflow-x-auto"><table className="table"><thead><tr><th>When</th><th>User</th><th>Result</th><th>IP</th></tr></thead>
              <tbody>{events.map((e) => <tr key={e.id}><td className="text-xs">{fmtDate(e.createdAt, true)}</td><td className="text-xs">{e.email}</td><td>{e.success ? <Badge tone="green">ok{e.newDevice ? " · new device" : ""}</Badge> : <Badge tone="red">{(e.reason ?? "failed").replace("_", " ")}</Badge>}</td><td className="text-xs">{e.ip ?? "—"}</td></tr>)}</tbody></table></div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Company security policy">
            <form id="policy" action={savePolicy} className="space-y-4">
              <Field label="Require two-factor authentication"><select name="require2fa" defaultValue={t.require2fa} className="input"><option value="none">Optional</option><option value="admins">Required for admins</option><option value="all">Required for everyone</option></select></Field>
              <Field label="Sign out after inactivity (minutes)"><input name="sessionIdleMins" type="number" min={15} defaultValue={t.sessionIdleMins} className="input" /></Field>
              <Field label="IP allowlist (Enterprise)" hint="One IP or CIDR per line, e.g. 203.0.113.0/24. Empty = allow all."><textarea name="ipAllowlist" rows={3} defaultValue={t.ipAllowlist.join("\n")} className="input font-mono text-xs" /></Field>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="maskPhones" defaultChecked={t.maskPhones} className="mt-1" /><span>Mask customer phone numbers for roles without “See full phone numbers”. Calls still connect normally.</span></label>
              <SubmitButton>Save policy</SubmitButton>
              <p className="text-xs text-muted">Always on: bcrypt passwords with policy, lockout after 5 failed attempts, new-device alerts, AES-256-GCM encrypted secrets, signed webhooks, security headers, tenant-isolated queries.</p>
            </form>
          </Card>
          {locked.length > 0 && <Card title="Locked accounts">{locked.map((m) => <form key={m.id} action={unlockUser.bind(null, m.userId)} className="flex items-center justify-between py-1 text-sm">{m.user.name}<SubmitButton className="btn-secondary btn-sm">Unlock</SubmitButton></form>)}</Card>}
          <Card title="Users without 2FA">
            <ul className="space-y-1 text-sm">{members.filter((m) => !m.user.totpEnabled).map((m) => <li key={m.id} className="flex justify-between"><span>{m.user.name}</span><span className="text-xs text-muted">{m.role.name}</span></li>)}</ul>
            {with2fa === members.length && <p className="text-sm text-green-700">Everyone has 2FA ✓</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
