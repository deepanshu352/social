"use client";
import { useActionState } from "react";
import { verifyMfa } from "../../actions";
import { AuthShell } from "../../AuthShell";

export default function MfaPage() {
  const [state, action, pending] = useActionState(verifyMfa, undefined);
  return (
    <AuthShell title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app.">
      <form action={action} className="space-y-4">
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className="input text-center text-lg tracking-[0.4em]" />
        {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        <button disabled={pending} className="btn-primary w-full">{pending ? "Verifying…" : "Verify"}</button>
      </form>
    </AuthShell>
  );
}
