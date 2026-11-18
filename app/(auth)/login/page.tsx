import Link from "next/link";
import { AuthShell } from "../AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <AuthShell title="Welcome back" subtitle={<>New here? <Link href="/signup" className="link">Start a 14-day free trial</Link></>}>
      {error === "ip" && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Your company only allows sign-in from approved networks. Connect from an allowed IP address.</p>}
      {error === "idle" && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">You were signed out after a period of inactivity.</p>}
      <LoginForm next={next} />
      <div className="mt-6 rounded-lg border border-dashed border-line p-3 text-xs text-muted">
        <div className="mb-1 font-medium text-ink">Demo accounts (password: <code>Password@123</code>)</div>
        admin@sharma.demo · manager@sharma.demo · telecaller@sharma.demo · accounts@sharma.demo · platform@bizos.demo
      </div>
    </AuthShell>
  );
}
