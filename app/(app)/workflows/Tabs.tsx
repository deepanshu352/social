import { Tabs } from "@/components/ui";
export function WfTabs({ active }: { active: string }) {
  return <Tabs active={active} items={[
    { key: "list", label: "Workflows", href: "/workflows" },
    { key: "recipes", label: "Recipe library", href: "/workflows/recipes" },
    { key: "runs", label: "Run history", href: "/workflows/runs" },
    { key: "templates", label: "Message templates", href: "/workflows/templates" },
    { key: "messages", label: "Sent messages", href: "/messages" },
  ]} />;
}
