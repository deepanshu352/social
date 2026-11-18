import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Membership, Role, Tenant, Branch } from "@prisma/client";
import { prisma } from "./prisma";
import { tenantDb, type TenantDb } from "./db";
import { signToken, verifyToken, SESSION_COOKIE } from "./token";
import type { PermissionMap, Scope } from "./rbac";
import { planByKey, type ModuleKey, type Plan } from "./plans";
import { ipAllowed, maskPhone } from "./security";

const SESSION_DAYS = 14;

export type Ctx = {
  sessionId: string;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean; totpEnabled: boolean };
  tenant: Tenant;
  membership: Membership & { role: Role; branch: Branch | null };
  perms: PermissionMap;
  db: TenantDb;
  plan: Plan;
  writable: boolean;
  /** false when the tenant masks phone numbers and the role lacks data.unmask */
  canUnmask: boolean;
  ip: string | null;
};

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
}

/** Why a signed-in user is blocked from the tenant (IP allowlist / idle timeout), if at all. */
export const accessBlock = cache(async (): Promise<null | "ip" | "idle"> => {
  const session = await getSessionUser();
  if (!session?.tenantId) return null;
  const t = await prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { ipAllowlist: true, sessionIdleMins: true } });
  if (!t) return null;
  if (!ipAllowed(await clientIp(), t.ipAllowlist)) return "ip";
  if (session.idleMs > t.sessionIdleMins * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return "idle";
  }
  return null;
});

export async function createSession(userId: string, tenantId: string | null) {
  const h = await headers();
  const session = await prisma.session.create({
    data: {
      userId, tenantId,
      userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0] || null,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
    },
  });
  const token = await signToken({ sid: session.id }, `${SESSION_DAYS}d`);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return session;
}

export async function destroySession() {
  const c = await cookies();
  const payload = await verifyToken<{ sid: string }>(c.get(SESSION_COOKIE)?.value);
  if (payload?.sid) await prisma.session.updateMany({ where: { id: payload.sid }, data: { revokedAt: new Date() } });
  c.delete(SESSION_COOKIE);
}

/** Loads the raw session + user (no tenant requirement). */
export const getSessionUser = cache(async () => {
  const c = await cookies();
  const payload = await verifyToken<{ sid: string }>(c.get(SESSION_COOKIE)?.value);
  if (!payload?.sid) return null;
  const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const idleMs = Date.now() - session.lastSeenAt.getTime();
  if (idleMs > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return { ...session, idleMs };
});

/** Full request context for tenant-scoped pages & actions. Null if not signed in / no tenant. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const session = await getSessionUser();
  if (!session || !session.tenantId) return null;
  if (await accessBlock()) return null;
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: session.tenantId, userId: session.userId } },
    include: { role: true, branch: true, tenant: true },
  });
  if (!membership || membership.status !== "active") return null;
  const { tenant, ...m } = membership;
  const u = session.user;
  const perms = (m.role.permissions ?? {}) as PermissionMap;
  return {
    sessionId: session.id,
    user: { id: u.id, name: u.name, email: u.email, isPlatformAdmin: u.isPlatformAdmin, totpEnabled: u.totpEnabled },
    tenant,
    membership: m,
    perms,
    db: tenantDb(tenant.id),
    plan: planByKey(tenant.plan),
    writable: !["restricted", "suspended", "cancelled"].includes(tenant.status),
    canUnmask: !tenant.maskPhones || !!perms["data.unmask"],
    ip: await clientIp(),
  };
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) {
    const s = await getSessionUser();
    if (s?.user.isPlatformAdmin && !s.tenantId) redirect("/platform");
    const block = await accessBlock();
    if (block === "ip") redirect("/login?error=ip");
    if (block === "idle") redirect("/login?error=idle");
    redirect("/login");
  }
  const mustHave2fa = ctx.tenant.require2fa === "all" || (ctx.tenant.require2fa === "admins" && ["admin", "branch_admin"].includes(ctx.membership.role.key));
  if (mustHave2fa && !ctx.user.totpEnabled) {
    const h = await headers();
    if (!(h.get("x-pathname") ?? "").startsWith("/settings/security")) redirect("/settings/security?enforce=1");
  }
  if (ctx.tenant.status === "suspended" || ctx.tenant.status === "cancelled") {
    const h = await headers();
    if (!(h.get("x-pathname") ?? "").startsWith("/settings/billing")) redirect("/settings/billing?suspended=1");
  }
  return ctx;
}

export function can(ctx: Ctx, perm: string): Scope | null {
  return ctx.perms[perm] ?? null;
}
export function has(ctx: Ctx, perm: string) {
  return !!ctx.perms[perm];
}
export function hasModule(ctx: Ctx, mod: ModuleKey) {
  return ctx.plan.modules.includes(mod);
}

export class ForbiddenError extends Error {
  constructor(public perm: string) { super(`You don't have permission: ${perm}`); }
}

/** Page guard: redirects to an access-denied page. */
export async function guard(perm: string, mod?: ModuleKey): Promise<Ctx> {
  const ctx = await requireCtx();
  if (mod && !hasModule(ctx, mod)) redirect(`/upgrade?module=${mod}`);
  if (!has(ctx, perm)) redirect(`/denied?p=${encodeURIComponent(perm)}`);
  return ctx;
}

/** Action guard: throws (caught by forms / API routes). */
export async function authorize(perm: string, opts: { write?: boolean; mod?: ModuleKey } = {}): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new ForbiddenError("auth");
  if (opts.mod && !hasModule(ctx, opts.mod)) throw new ForbiddenError(`module:${opts.mod}`);
  if (!has(ctx, perm)) throw new ForbiddenError(perm);
  if (opts.write !== false && !ctx.writable) throw new Error("Your workspace is read-only. Please renew your subscription.");
  return ctx;
}

const teamCache = new WeakMap<Ctx, Promise<string[]>>();
/** Membership ids visible at 'team' scope: me + same team + my direct reports. */
export function teamMemberIds(ctx: Ctx) {
  let p = teamCache.get(ctx);
  if (!p) {
    p = ctx.db.membership
      .findMany({
        where: { OR: [{ id: ctx.membership.id }, { managerId: ctx.membership.id }, ...(ctx.membership.teamId ? [{ teamId: ctx.membership.teamId }] : [])] },
        select: { id: true },
      })
      .then((r) => r.map((x) => x.id));
    teamCache.set(ctx, p);
  }
  return p;
}

/**
 * Prisma `where` fragment that limits records to what the user's scope allows.
 * `ownerField` is the membership FK on the model (ownerId, agentId, assigneeId...).
 */
export async function scopeWhere(ctx: Ctx, perm: string, ownerField = "ownerId", branchField: string | null = "branchId"): Promise<Record<string, unknown>> {
  const scope = can(ctx, perm);
  if (!scope) return { id: "__none__" };
  if (scope === "all") return {};
  if (scope === "branch" && branchField && ctx.membership.branchId) return { [branchField]: ctx.membership.branchId };
  if (scope === "team" || scope === "branch") return { [ownerField]: { in: await teamMemberIds(ctx) } };
  return { [ownerField]: ctx.membership.id };
}

/** Phone number as this user may see it (BRD §16 number masking). Calls are still placed with the real number server-side. */
export function phoneFor(ctx: Ctx, phone: string | null | undefined) {
  return ctx.canUnmask ? phone ?? null : maskPhone(phone);
}
