"use client";
import { useActionState } from "react";
import { login } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block"><span className="label">Email</span><input name="email" type="email" required autoComplete="email" className="input" placeholder="you@company.com" /></label>
      <label className="block"><span className="label">Password</span><input name="password" type="password" required autoComplete="current-password" className="input" /></label>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="btn-primary w-full">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
