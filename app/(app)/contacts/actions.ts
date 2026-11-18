"use server";
import { guarded } from "@/lib/action";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize, scopeWhere } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizePhone, optStr, str } from "@/lib/utils";
import { parseCustom } from "@/lib/custom";

function fields(fd: FormData) {
  return {
    name: str(fd.get("name")), companyName: optStr(fd.get("companyName")),
    ...(fd.has("phone") ? { phone: normalizePhone(optStr(fd.get("phone"))) } : {}),
    email: optStr(fd.get("email"))?.toLowerCase() ?? null, gstin: optStr(fd.get("gstin"))?.toUpperCase() ?? null,
    stateCode: optStr(fd.get("stateCode")), address: optStr(fd.get("address")),
    tags: str(fd.get("tags")).split(",").map((t) => t.trim()).filter(Boolean),
  };
}

export async function createContactAction(fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("contact.edit");
  const data = { ...fields(fd), custom: parseCustom(await ctx.db.customFieldDef.findMany({ where: { entity: "contact" } }), fd) as object };
  if (!data.name) throw new Error("Name is required");
  if (data.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(data.gstin)) throw new Error("GSTIN must be 15 characters");
  const c = await ctx.db.contact.create({ data: { ...data, tenantId: ctx.tenant.id, ownerId: ctx.membership.id, branchId: ctx.membership.branchId, stateCode: data.stateCode ?? (data.gstin ? data.gstin.slice(0, 2) : ctx.tenant.stateCode) } });
  await audit(ctx, "contact.create", "Contact", c.id, null, data);
  redirect(`/contacts/${c.id}`);
});
}

export async function updateContactAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("contact.edit");
  const before = await ctx.db.contact.findFirst({ where: { id, ...(await scopeWhere(ctx, "contact.view")) } });
  if (!before) throw new Error("Not found");
  const data = { ...fields(fd), dnd: fd.get("dnd") === "on", custom: parseCustom(await ctx.db.customFieldDef.findMany({ where: { entity: "contact" } }), fd, (before.custom ?? {}) as Record<string, unknown>) as object };
  await ctx.db.contact.update({ where: { id }, data });
  if (data.dnd && data.phone) await ctx.db.dndNumber.upsert({ where: { tenantId_phone: { tenantId: ctx.tenant.id, phone: data.phone } }, create: { tenantId: ctx.tenant.id, phone: data.phone, reason: "Marked DND on customer" }, update: {} });
  await audit(ctx, "contact.update", "Contact", id, before, data);
  revalidatePath(`/contacts/${id}`);
});
}

export async function addContactNoteAction(id: string, fd: FormData) {
  return guarded(async () => {
  const ctx = await authorize("contact.view");
  const body = str(fd.get("body"));
  if (body) await ctx.db.activity.create({ data: { tenantId: ctx.tenant.id, contactId: id, type: "note", body, actorId: ctx.membership.id } });
  revalidatePath(`/contacts/${id}`);
});
}
