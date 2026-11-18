import Link from "next/link";
import { Card } from "@/components/ui";
import { PLANS } from "@/lib/plans";

export default async function Upgrade({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module } = await searchParams;
  const plan = PLANS.find((p) => p.modules.includes(module as never));
  return <Card className="mx-auto mt-12 max-w-md text-center"><h1 className="text-lg font-semibold">Upgrade to unlock {module}</h1><p className="mt-2 text-sm text-muted">This module is included from the <b>{plan?.name ?? "higher"}</b> plan.</p><Link href="/settings/billing" className="btn-primary mt-4">See plans</Link></Card>;
}
