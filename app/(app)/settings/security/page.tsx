import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireCtx } from "@/lib/auth";
import { Card, PageHeader, Badge, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { prisma } from "@/lib/prisma";
import { generateSecret, otpauthUrl, verifyTotp } from "@/lib/totp";
import { audit } from "@/lib/audit";
import { fmtDate, str, timeAgo } from "@/lib/utils";
import { decrypt, encrypt, passwordProblems } from "@/lib/security";
import { guarded } from "@/lib/action";

export const metadata = { title: "My security" };

async function me() {
  const s = await getSessionUser();
  if (!s) throw new Error("Not signed in");
  return s;
}
async function changePassword(fd: FormData) {
  "use server";
  return guarded(async () => {
  const s = await me();
  if (!(await bcrypt.compare(str(fd.get("current")), s.user.passwordHash))) throw new Error("Current password is wrong");
  const next = str(fd.get("next"));
  const weak = passwordProblems(next, s.user.email);
  if (weak) throw new Error(weak);
  await prisma.user.update({ where: { id: s.userId }, data: { passwordHash: await bcrypt.hash(next, 10), passwordChangedAt: new Date() } });
  await prisma.session.updateMany({ where: { userId: s.userId, id: { not: s.id }, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath("/settings/security");
});
}
async function startTotp() {
  "use server";
  return guarded(async () => {
  const s = await me();
  await prisma.user.update({ where: { id: s.userId }, data: { totpSecret: encrypt(generateSecret()), totpEnabled: false } });
  revalidatePath("/settings/security");
});
}
async function confirmTotp(fd: FormData) {
  "use server";
  return guarded(async () => {
  const s = await me();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
  if (!u.totpSecret || !verifyTotp(decrypt(u.totpSecret)!, str(fd.get("code")))) throw new Error("Code didn't match — check your phone's clock and try again");
  await prisma.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
  const ctx = await requireCtx();
  await audit(ctx, "user.2fa_enabled", "User", u.id);
  revalidatePath("/settings/security");
});
}
async function disableTotp(fd: FormData) {
  "use server";
  return guarded(async () => {
  const s = await me();
  if (!s.user.totpSecret || !verifyTotp(decrypt(s.user.totpSecret)!, str(fd.get("code")))) throw new Error("Enter a valid current code to disable 2FA");
  await prisma.user.update({ where: { id: s.userId }, data: { totpEnabled: false, totpSecret: null } });
  revalidatePath("/settings/security");
});
}
async function revoke(id: string) {
  "use server";
  return guarded(async () => {
  const s = await me();
  await prisma.session.updateMany({ where: { id, userId: s.userId }, data: { revokedAt: new Date() } });
  revalidatePath("/settings/security");
});
}

export default async function Security({ searchParams }: { searchParams: Promise<{ enforce?: string }> }) {
  const ctx = await requireCtx();
  const s = await me();
  const [user, sessions, logins] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } }),
    prisma.session.findMany({ where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
    prisma.loginEvent.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const secret = decrypt(user.totpSecret);
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="My security" subtitle={user.email} />
      {sp.enforce && !user.totpEnabled && <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Your company requires two-factor authentication. Set it up below to continue using the app.</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2">Two-factor authentication {user.totpEnabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</span>}>
          {user.totpEnabled ? (
            <form action={disableTotp} className="flex gap-2"><input name="code" placeholder="Current 6-digit code" className="input w-48" /><SubmitButton className="btn-secondary">Disable 2FA</SubmitButton></form>
          ) : user.totpSecret ? (
            <div className="space-y-3 text-sm">
              <p>Add this account in Google Authenticator / Authy using the setup key:</p>
              <code className="block break-all rounded-lg bg-gray-50 p-3 text-sm tracking-wider">{secret}</code>
              <p className="break-all text-xs text-muted">{otpauthUrl(secret!, user.email)}</p>
              <form action={confirmTotp} className="flex gap-2"><input name="code" inputMode="numeric" placeholder="6-digit code" className="input w-40" /><SubmitButton>Verify & enable</SubmitButton></form>
            </div>
          ) : (
            <form action={startTotp}><p className="mb-3 text-sm text-muted">Protect your account with a code from your phone at every sign-in.</p><SubmitButton>Set up 2FA</SubmitButton></form>
          )}
        </Card>
        <Card title="Change password">
          <form action={changePassword} className="space-y-3">
            <Field label="Current password"><input name="current" type="password" required className="input" /></Field>
            <Field label="New password"><input name="next" type="password" minLength={8} required className="input" /></Field>
            <SubmitButton>Update password</SubmitButton>
            <p className="text-xs text-muted">At least 10 characters with letters and a number. Signs you out on all other devices.</p>
          </form>
        </Card>
        <Card title="Recent sign-in activity" pad={false} className="lg:col-span-2">
          <table className="table"><thead><tr><th>When</th><th>Result</th><th>IP</th><th>Device</th></tr></thead>
            <tbody>{logins.map((l) => <tr key={l.id}><td className="text-xs">{fmtDate(l.createdAt, true)}</td><td>{l.success ? <Badge tone="green">Success{l.newDevice ? " · new device" : ""}</Badge> : <Badge tone="red">{(l.reason ?? "failed").replace("_", " ")}</Badge>}</td><td className="text-xs">{l.ip ?? "—"}</td><td className="max-w-sm truncate text-xs">{l.userAgent}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Active sessions" pad={false} className="lg:col-span-2">
          <table className="table"><thead><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last active</th><th></th></tr></thead>
            <tbody>{sessions.map((x) => (
              <tr key={x.id}>
                <td className="max-w-sm truncate text-xs">{x.userAgent ?? "Unknown"} {x.id === s.id && <Badge tone="blue">This device</Badge>}</td>
                <td className="text-xs">{x.ip ?? "—"}</td><td className="text-xs">{fmtDate(x.createdAt, true)}</td><td className="text-xs">{timeAgo(x.lastSeenAt)}</td>
                <td>{x.id !== s.id && <form action={revoke.bind(null, x.id)}><SubmitButton className="btn-ghost btn-sm">Sign out</SubmitButton></form>}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
