"use client";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { checkIn, checkOut } from "./actions";

function locate(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 8000 });
  });
}

export function CheckButtons({ state }: { state: "none" | "in" | "done" }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(fn: typeof checkIn) {
    setBusy(true); setErr(null);
    try { await fn(await locate()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      {state === "none" && <button disabled={busy} onClick={() => go(checkIn)} className="btn-primary px-6 py-3 text-base"><MapPin size={18} />{busy ? "Locating…" : "Check in"}</button>}
      {state === "in" && <button disabled={busy} onClick={() => go(checkOut)} className="btn-danger px-6 py-3 text-base"><MapPin size={18} />{busy ? "Locating…" : "Check out"}</button>}
      {state === "done" && <p className="text-sm text-green-700">✓ Day complete. See you tomorrow!</p>}
      <p className="mt-2 text-xs text-muted">Your location is recorded only at check-in and check-out.</p>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}
