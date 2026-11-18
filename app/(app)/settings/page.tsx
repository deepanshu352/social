import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize, requireCtx, has } from "@/lib/auth";
import { Card, PageHeader, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { STATES } from "@/lib/india";
import { BUSINESS_TYPES } from "@/lib/plans";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { optStr, str } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "Company settings" };

async function save(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("settings.manage");
  const gstin = optStr(fd.get("gstin"))?.toUpperCase() ?? null;
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error("GSTIN must be 15 characters");
  const data = {
    name: str(fd.get("name")) || ctx.tenant.name, businessType: str(fd.get("businessType")) as any, gstin,
    stateCode: gstin ? gstin.slice(0, 2) : str(fd.get("stateCode")), address: optStr(fd.get("address")), phone: optStr(fd.get("phone")),
    email: optStr(fd.get("email")), timezone: str(fd.get("timezone")) || "Asia/Kolkata", invoiceTerms: optStr(fd.get("invoiceTerms")), bankDetails: optStr(fd.get("bankDetails")),
  };
  await prisma.tenant.update({ where: { id: ctx.tenant.id }, data });
  await audit(ctx, "tenant.update", "Tenant", ctx.tenant.id, ctx.tenant, data);
  revalidatePath("/", "layout");
});
}

export default async function CompanySettings() {
  const ctx = await requireCtx();
  if (!has(ctx, "settings.manage")) redirect("/settings/security");
  const t = ctx.tenant;
  return (
    <>
      <PageHeader title="Company" subtitle="Appears on quotations, invoices and customer links." />
      <form action={save}>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company name"><input name="name" defaultValue={t.name} className="input" /></Field>
            <Field label="Business type" hint="Drives which modules are emphasised"><select name="businessType" defaultValue={t.businessType} className="input">{BUSINESS_TYPES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
            <Field label="GSTIN"><input name="gstin" defaultValue={t.gstin ?? ""} maxLength={15} className="input uppercase" /></Field>
            <Field label="State (used if no GSTIN)"><select name="stateCode" defaultValue={t.stateCode} className="input">{Object.entries(STATES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
            <Field label="Phone"><input name="phone" defaultValue={t.phone ?? ""} className="input" /></Field>
            <Field label="Email"><input name="email" defaultValue={t.email ?? ""} className="input" /></Field>
            <Field label="Timezone"><input name="timezone" defaultValue={t.timezone} className="input" /></Field>
            <Field label="Address" className="md:col-span-2"><textarea name="address" rows={2} defaultValue={t.address ?? ""} className="input" /></Field>
            <Field label="Default invoice terms"><textarea name="invoiceTerms" rows={3} defaultValue={t.invoiceTerms ?? ""} className="input" /></Field>
            <Field label="Bank / UPI details (printed on invoices)"><textarea name="bankDetails" rows={3} defaultValue={t.bankDetails ?? ""} className="input" placeholder={"HDFC Bank · A/c 50200012345678 · IFSC HDFC0001234\nUPI: company@hdfcbank"} /></Field>
          </div>
          <div className="mt-5"><SubmitButton>Save company</SubmitButton></div>
        </Card>
      </form>
    </>
  );
}
