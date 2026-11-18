"use client";
import { useActionState } from "react";
import { signup } from "../actions";

export function SignupForm({ types, states }: { types: { key: string; label: string }[]; states: [string, string][] }) {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <form action={action} className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Your name</span><input name="name" required className="input" /></label>
        <label className="block"><span className="label">Mobile</span><input name="phone" className="input" placeholder="98xxxxxxxx" /></label>
      </div>
      <label className="block"><span className="label">Work email</span><input name="email" type="email" required className="input" /></label>
      <label className="block"><span className="label">Password</span><input name="password" type="password" minLength={10} required className="input" /></label>
      <label className="block"><span className="label">Company name</span><input name="company" required className="input" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Business type</span>
          <select name="businessType" className="input">{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        </label>
        <label className="block"><span className="label">State (GST)</span>
          <select name="stateCode" defaultValue="07" className="input">{states.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        </label>
      </div>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="btn-primary w-full">{pending ? "Creating your workspace…" : "Start free trial"}</button>
      <p className="text-center text-xs text-muted">14 days of the Professional plan. No card required.</p>
    </form>
  );
}
