import { guard } from "@/lib/auth";
import { Card, PageHeader, Badge, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveTemplate, deleteTemplate } from "../actions";
import { WfTabs } from "../Tabs";

export const metadata = { title: "Message templates" };

export default async function Templates({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await guard("workflow.manage", "workflows");
  const { edit } = await searchParams;
  const tpls = await ctx.db.messageTemplate.findMany({ orderBy: [{ channel: "asc" }, { name: "asc" }] });
  const e = tpls.find((t) => t.id === edit);
  return (
    <>
      <PageHeader title="Message templates" subtitle="Reusable email, WhatsApp and SMS messages with {{variables}} — used by workflows and the Send message panel." />
      <WfTabs active="templates" />
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-3">{tpls.map((t) => (
          <Card key={t.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex items-center gap-2 font-medium">{t.name} <Badge tone={t.channel === "email" ? "blue" : t.channel === "whatsapp" ? "green" : "amber"}>{t.channel}</Badge></div>
                {t.subject && <div className="mt-1 text-sm"><span className="text-muted">Subject:</span> {t.subject}</div>}
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{t.body}</p></div>
              <div className="flex shrink-0 gap-1"><a href={`/workflows/templates?edit=${t.id}`} className="btn-ghost btn-sm">Edit</a><form action={deleteTemplate.bind(null, t.id)}><SubmitButton className="btn-ghost btn-sm text-red-700" confirm="Delete template? Workflow steps using it will be skipped.">Delete</SubmitButton></form></div>
            </div>
          </Card>
        ))}</div>
        <Card title={e ? "Edit template" : "New template"} className="h-fit">
          <form action={saveTemplate} key={e?.id ?? "new"} className="space-y-3">
            {e && <input type="hidden" name="id" value={e.id} />}
            <Field label="Name"><input name="name" required defaultValue={e?.name} className="input" /></Field>
            <Field label="Channel"><select name="channel" defaultValue={e?.channel ?? "whatsapp"} className="input"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></select></Field>
            <Field label="Subject (email)"><input name="subject" defaultValue={e?.subject ?? ""} className="input" /></Field>
            <Field label="Body"><textarea name="body" required rows={7} defaultValue={e?.body} className="input" /></Field>
            <p className="text-xs text-muted">Variables: {"{{lead.first_name}} {{lead.product}} {{owner.name}} {{contact.name}} {{invoice.number}} {{invoice.balance}} {{invoice.due_date}} {{invoice.link}} {{quotation.number}} {{quotation.link}} {{ticket.number}} {{company.name}}"}</p>
            <SubmitButton>{e ? "Save" : "Create template"}</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
