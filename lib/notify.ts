import { prisma } from "./prisma";

export async function notify(tenantId: string, membershipId: string | null | undefined, title: string, body?: string, link?: string) {
  if (!membershipId) return;
  await prisma.notification.create({ data: { tenantId, membershipId, title, body, link } });
}

export async function notifyMany(tenantId: string, membershipIds: string[], title: string, body?: string, link?: string) {
  if (!membershipIds.length) return;
  await prisma.notification.createMany({ data: membershipIds.map((membershipId) => ({ tenantId, membershipId, title, body, link })) });
}

/** Members holding a given permission (e.g. managers who can approve). */
export async function membersWithPerm(tenantId: string, perm: string) {
  const ms = await prisma.membership.findMany({ where: { tenantId, status: "active" }, include: { role: true } });
  return ms.filter((m) => (m.role.permissions as Record<string, string>)[perm]).map((m) => m.id);
}
