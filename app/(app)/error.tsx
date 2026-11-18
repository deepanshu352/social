"use client";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Friendly boundary for any server-action / render error inside the app shell. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const msg = error.message && !/digest|Server Components render/i.test(error.message) ? error.message : "Something went wrong while processing your request.";
  return (
    <div className="card mx-auto mt-12 max-w-lg p-8 text-center">
      <AlertTriangle className="mx-auto text-amber-500" size={36} />
      <h1 className="mt-3 text-lg font-semibold">That didn&apos;t work</h1>
      <p className="mt-2 text-sm text-muted">{msg}</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-gray-400">Ref: {error.digest}</p>}
      <div className="mt-5 flex justify-center gap-2"><button onClick={reset} className="btn-primary">Try again</button><Link href="/dashboard" className="btn-secondary">Dashboard</Link></div>
    </div>
  );
}
