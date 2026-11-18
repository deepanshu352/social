import { guard } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";
import { PageHeader } from "@/components/ui";
import { Chat } from "./Chat";

export const metadata = { title: "AI Copilot" };

export default async function CopilotPage() {
  const ctx = await guard("ai.use", "ai");
  return (
    <>
      <PageHeader title="AI Business Copilot" subtitle="Answers with supporting data, explanation and a recommended action. Every AI action is audit-logged." />
      <Chat enabled={aiEnabled()} name={ctx.user.name.split(" ")[0]} />
    </>
  );
}
