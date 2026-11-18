import Link from "next/link";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-700 p-10 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-brand-700">B</span> BizOS
        </Link>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Run your entire business from one platform.</h2>
          <p className="mt-3 max-w-md text-brand-100">Leads, calls, sales, quotations, invoices and payments — with an AI Copilot that tells you what happened, why, and what to do next.</p>
        </div>
        <p className="text-xs text-brand-100">Aapke business ke Leads, Calls, Sales aur Payments — sab ek hi platform par.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
