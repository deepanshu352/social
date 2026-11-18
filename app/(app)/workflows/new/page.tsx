import { guard } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Builder } from "../Builder";
import { builderOpts } from "../opts";
import { saveWorkflow } from "../actions";

export const metadata = { title: "New workflow" };

export default async function NewWorkflow() {
  const ctx = await guard("workflow.manage", "workflows");
  return (
    <>
      <PageHeader title="New workflow" back={{ href: "/workflows", label: "Workflows" }} />
      <Builder opts={await builderOpts(ctx)} action={saveWorkflow.bind(null, null)} submitLabel="Create workflow"
        initial={{ name: "", description: "", isActive: true, trigger: "lead.created", triggerConfig: {}, conditions: [], steps: [{ id: "s1", type: "action", action: "notify", config: { to: "owner", title: "New lead: {{lead.name}}", body: "{{lead.product}} · {{lead.city}}" } }] }} />
    </>
  );
}
