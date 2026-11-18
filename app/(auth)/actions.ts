"use server";
import { guarded } from "@/lib/action";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { provisionTenant } from "@/lib/tenant-setup";
import { signToken, verifyToken, MFA_COOKIE } from "@/lib/token";
import { verifyTotp } from "@/lib/totp";
import { decrypt, passwordProblems } from "@/lib/security";
import { headers } from "next/headers";
import { notify } from "@/lib/notify";
import { TRIAL_DAYS } from "@/lib/plans";
import { str } from "@/lib/utils";

export type FormState = { error?: string } | undefined;

// Per-IP failure throttle (in-memory, per process — use Redis when running several instances).
// Per-account lockout (5 failures → 15 min) is enforced in the database below.
const failures = new Map<string, { n: number; at: number }>();
function throttled(key: string) {
  const a = failures.get(key);
  if (!a || Date.now() - a.at > 15 * 60_000) return false;
  return a.n >= 30;
}
function fail(key: string) {
  const a = failures.get(key);
  if (!a || Date.now() - a.at > 15 * 60_000) failures.set(key, { n: 1, at: Date.now() });
  else a.n++;
}

async function reqMeta() {
  const h = await headers();
  return { ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null, userAgent: h.get("user-agent")?.slice(0, 250) ?? null };
}

async function recordLogin(email: string, userId: string | null, success: boolean, reason?: string, tenantId?: string | null) {
  const { ip, userAgent } = await reqMeta();
  let newDevice = false;
  if (success && userId) {
    const seen = await prisma.loginEvent.findFirst({ where: { userId, success: true, userAgent, ip } });
    const any = await prisma.loginEvent.count({ where: { userId, success: true } });
    newDevice = !seen && any > 0;
  }
  await prisma.loginEvent.create({ data: { email, userId, tenantId: tenantId ?? null, ip, userAgent, success, reason, newDevice } });
  if (newDevice && userId) {
    const ms = await prisma.membership.findMany({ where: { userId, status: "active" } });
    for (const m of ms) await notify(m.tenantId, m.id, "New sign-in to your account", `From ${ip ?? "unknown IP"} · ${userAgent?.slice(0, 80) ?? "unknown device"}. Not you? Change your password and sign out other sessions.`, "/settings/security");
  }
}

async function landing(userId: string, isPlatformAdmin: boolean, next?: string) {
  const m = await prisma.membership.findFirst({ where: { userId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (!m && !isPlatformAdmin) return { error: "Your account is not part of any active company." };
  const u = await prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null } });
  await recordLogin(u.email, userId, true, undefined, m?.tenantId);
  await createSession(userId, m?.tenantId ?? null);
  redirect(m ? (next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard") : "/platform");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  return guarded(async () => {
  const email = str(fd.get("email")).toLowerCase();
  const password = str(fd.get("password"));
  const ipKey = `ip:${(await reqMeta()).ip ?? "unknown"}`;
  if (throttled(ipKey)) return { error: "Too many failed attempts from your network. Try again in 15 minutes." };
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await recordLogin(email, user.id, false, "locked");
    return { error: `Account temporarily locked after repeated failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString("en-IN")}.` };
  }
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    if (user) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
    }
    await recordLogin(email, user?.id ?? null, false, user ? "bad_password" : "unknown_user");
    fail(ipKey);
    return { error: "Invalid email or password." };
  }
  if (user.totpEnabled) {
    (await cookies()).set(MFA_COOKIE, await signToken({ uid: user.id, next: str(fd.get("next")) }, "5m"), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
    redirect("/login/mfa");
  }
  return landing(user.id, user.isPlatformAdmin, str(fd.get("next")));
});
}

export async function verifyMfa(_: FormState, fd: FormData): Promise<FormState> {
  return guarded(async () => {
  const c = await cookies();
  const p = await verifyToken<{ uid: string; next?: string }>(c.get(MFA_COOKIE)?.value);
  if (!p) redirect("/login");
  if (throttled(`mfa:${p.uid}`)) return { error: "Too many attempts." };
  const u0 = await prisma.user.findUnique({ where: { id: p.uid } });
  if (u0?.lockedUntil && u0.lockedUntil > new Date()) return { error: "Account temporarily locked. Try again later." };
  const user = await prisma.user.findUnique({ where: { id: p.uid } });
  if (!user?.totpSecret || !verifyTotp(decrypt(user.totpSecret)!, str(fd.get("code")))) {
    if (user) {
      await recordLogin(user.email, user.id, false, "bad_2fa");
      const failed = user.failedLogins + 1;
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
    }
    fail(`mfa:${p.uid}`);
    return { error: "Invalid code." };
  }
  c.delete(MFA_COOKIE);
  return landing(user.id, user.isPlatformAdmin, p.next);
});
}

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  return guarded(async () => {
  const name = str(fd.get("name"));
  const email = str(fd.get("email")).toLowerCase();
  const password = str(fd.get("password"));
  const company = str(fd.get("company"));
  const businessType = str(fd.get("businessType")) || "other";
  const stateCode = str(fd.get("stateCode")) || "07";
  if (!name || !company) return { error: "Name and company are required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email." };
  const weak = passwordProblems(password, email);
  if (weak) return { error: weak };
  if (await prisma.user.findUnique({ where: { email } })) return { error: "An account with this email already exists. Sign in instead." };

  const base = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, passwordHash, phone: str(fd.get("phone")) || null } });
    const tenant = await tx.tenant.create({
      data: { name: company, slug, businessType: businessType as any, stateCode, email, status: "trial", plan: "professional", trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000) },
    });
    const { branch, adminRole } = await provisionTenant(tx, tenant.id, stateCode, businessType);
    await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, roleId: adminRole.id, branchId: branch.id, title: "Owner" } });
    return user;
  }, { timeout: 30_000 });
  await createSession(user.id, (await prisma.membership.findFirstOrThrow({ where: { userId: user.id } })).tenantId);
  redirect("/dashboard?welcome=1");
});
}
