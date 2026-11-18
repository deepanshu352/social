import { Sparkles } from "lucide-react";
import { guard } from "@/lib/auth";
import { Card, PageHeader, Badge } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { RECIPES } from "@/lib/workflow-recipes";
import { TRIGGERS, type Step } from "@/lib/workflows";
import { installRecipe } from "../actions";
import { WfTabs } from "../Tabs";

export const metadata = { title: "Workflow recipes" };

function describe(steps: Step[], depth = 0): string[] {
  return steps.flatMap((s) => s.type === "wait" ? [`${"  ".repeat(depth)}WAIT ${s.amount} ${s.unit}`]
    : s.type === "condition" ? [`${"  ".repeat(depth)}IF ${s.conditions.map((c) => `${c.field} ${c.op} ${c.value ?? ""}`).join(" & ")}`, ...describe(s.then, depth + 1), ...(s.else.length ? [`${"  ".repeat(depth)}ELSE`, ...describe(s.else, depth + 1)] : [])]
    : [`${"  ".repeat(depth)}→ ${s.action.replace(/_/g, " ")}`]);
}

export default async function Recipes() {
  const ctx = await guard("workflow.manage", "workflows");
  const installed = new Set((await ctx.db.workflow.findMany({ select: { recipeKey: true } })).map((w) => w.recipeKey));
  const cats = [...new Set(RECIPES.map((r) => r.category))];
  return (
    <>
      <PageHeader title="Recipe library" subtitle={`${RECIPES.length} proven automations. Install one, then customise every step.`} />
      <WfTabs active="recipes" />
      {cats.map((cat) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{cat}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {RECIPES.filter((r) => r.category === cat).map((r) => (
              <Card key={r.key} className="flex flex-col">
                <div className="flex items-start justify-between gap-2"><div className="font-medium">{r.name}</div>{r.steps.some((s) => s.type === "action" && s.action.startsWith("ai_")) && <Badge tone="red"><Sparkles size={11} />AI</Badge>}</div>
                <p className="mt-1 text-sm text-muted">{r.description}</p>
                <div className="mt-3 text-xs"><Badge tone="violet">WHEN {TRIGGERS.find((t) => t.key === r.trigger)?.label}</Badge></div>
                <pre className="mt-2 flex-1 overflow-x-auto whitespace-pre rounded-lg bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">{describe(r.steps).join("\n")}</pre>
                <form action={installRecipe.bind(null, r.key)} className="mt-3">
                  <SubmitButton className={installed.has(r.key) ? "btn-secondary btn-sm w-full" : "btn-primary btn-sm w-full"} pendingText="Installing…">{installed.has(r.key) ? "Installed — add another copy" : "Install recipe"}</SubmitButton>
                </form>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
