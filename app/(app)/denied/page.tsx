import Link from "next/link";
import { Card } from "@/components/ui";

export default async function Denied({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  return <Card className="mx-auto mt-12 max-w-md text-center"><h1 className="text-lg font-semibold">Access restricted</h1><p className="mt-2 text-sm text-muted">Your role doesn&apos;t include the <code>{p}</code> permission. Ask your company admin to update your role.</p><Link href="/dashboard" className="btn-secondary mt-4">Back to dashboard</Link></Card>;
}
