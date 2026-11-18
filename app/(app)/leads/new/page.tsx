import { guard, has } from "@/lib/auth";
import { Card, PageHeader, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createLeadAction } from "../actions";
import { titleCase } from "@/lib/utils";
import { CustomFieldInputs } from "@/components/CustomFields";

export const metadata = { title: "New lead" };
const SOURCES = ["manual", "phone", "website", "google_ads", "facebook", "instagram", "whatsapp", "referral", "campaign", "landing_page"];

export default async function NewLead() {
  const ctx = await guard("lead.create", "crm");
  const defs = await ctx.db.customFieldDef.findMany({ where: { entity: "lead" }, orderBy: { order: "asc" } });
  const members = has(ctx, "lead.assign") ? await ctx.db.membership.findMany({ where: { status: "active" }, include: { user: true } }) : [];
  return (
    <>
      <PageHeader title="New lead" back={{ href: "/leads", label: "Leads" }} />
      <form action={createLeadAction} className="max-w-3xl">
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name *"><input name="name" required className="input" autoFocus /></Field>
            <Field label="Company"><input name="companyName" className="input" /></Field>
            <Field label="Mobile" hint="Normalised to +91 automatically; duplicates are flagged."><input name="phone" className="input" placeholder="98765 43210" /></Field>
            <Field label="Email"><input name="email" type="email" className="input" /></Field>
            <Field label="Source"><select name="source" className="input">{SOURCES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select></Field>
            <Field label="Campaign"><input name="campaign" className="input" /></Field>
            <Field label="Product / interest"><input name="product" className="input" /></Field>
            <Field label="Budget (₹)"><input name="budget" inputMode="decimal" className="input" /></Field>
            <Field label="City"><input name="city" className="input" /></Field>
            <Field label="State"><input name="state" className="input" /></Field>
            <Field label="Language"><select name="language" className="input"><option value="">—</option><option value="hi">Hindi</option><option value="en">English</option><option value="pa">Punjabi</option><option value="mr">Marathi</option><option value="ta">Tamil</option><option value="te">Telugu</option><option value="bn">Bengali</option><option value="gu">Gujarati</option></select></Field>
            <Field label="Priority"><select name="priority" defaultValue="medium" className="input"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>
            {members.length > 0 && (
              <Field label="Owner" hint="Leave empty to use assignment rules."><select name="ownerId" className="input"><option value="">Auto-assign</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select></Field>
            )}
            <Field label="Tags" hint="Comma separated"><input name="tags" className="input" /></Field>
            <CustomFieldInputs defs={defs} />
            <Field label="Notes" className="md:col-span-2"><textarea name="notes" rows={3} className="input" /></Field>
          </div>
          <div className="mt-5 flex justify-end"><SubmitButton>Create lead</SubmitButton></div>
        </Card>
      </form>
    </>
  );
}
