import { tick } from "./workflows";

let started = false;

export function startScheduler() {
  if (started || process.env.INTERNAL_SCHEDULER === "off") return;
  started = true;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { console.error("[scheduler]", e); } finally { busy = false; }
  }, 60_000);
  timer.unref?.();
}
