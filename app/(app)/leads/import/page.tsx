import { guard } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ImportForm } from "./ImportForm";

export const metadata = { title: "Import leads" };

export default async function ImportPage() {
  await guard("lead.import", "crm");
  return (
    <>
      <PageHeader title="Import leads" back={{ href: "/leads", label: "Leads" }} subtitle="Up to 5,000 rows per file. Each lead runs through dedupe, assignment rules, scoring and automations." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2"><ImportForm /></Card>
        <Card title="Recognised columns">
          <ul className="space-y-1 text-sm text-muted">
            <li><b className="text-ink">name</b> (required)</li><li>phone / mobile</li><li>email</li><li>company</li>
            <li>source (facebook, google_ads, website…)</li><li>city, state</li><li>product, campaign</li><li>budget (₹)</li><li>language, notes</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
