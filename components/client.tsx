"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

export function SubmitButton({ children, className = "btn-primary", pendingText, confirm, name, value, formAction }: {
  children: React.ReactNode; className?: string; pendingText?: string; confirm?: string; name?: string; value?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} formAction={formAction} disabled={pending} className={className}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition", active ? "bg-brand-50 font-medium text-brand-700" : "text-gray-600 hover:bg-gray-100 hover:text-ink")}>
      {children}
    </Link>
  );
}

export function PrintButton() {
  return <button className="btn-secondary no-print" onClick={() => window.print()}>Print / Save PDF</button>;
}

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  return (
    <button type="button" className="btn-secondary" onClick={async (e) => {
      await navigator.clipboard.writeText(text);
      const b = e.currentTarget; const old = b.textContent; b.textContent = "Copied!"; setTimeout(() => (b.textContent = old), 1200);
    }}>{label}</button>
  );
}

export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
