import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

/**
 * Production builds hide messages of errors thrown in Server Actions. Every action body runs through
 * guarded(): validation / permission errors send the user back to the same page with ?_err=<message>,
 * which the <Flash> component shows as a notification. Next.js control flow (redirect, notFound) passes through.
 */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    const msg = e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
    if (!(e instanceof Error) || /prisma|ECONN|database|Invalid `/i.test(msg)) console.error(e);
    const h = await headers();
    let back = "/dashboard";
    try {
      const ref = new URL(h.get("referer") ?? "");
      if (ref.host === h.get("host")) { ref.searchParams.delete("_ok"); ref.searchParams.set("_err", safe(msg)); back = ref.pathname + ref.search; }
    } catch { /* no referer */ }
    redirect(back.includes("_err=") ? back : `${back}?_err=${encodeURIComponent(safe(msg))}`);
  }
}

const safe = (m: string) => (/prisma|ECONN|database|Invalid `/i.test(m) ? "A server error occurred. Please try again." : m).slice(0, 300);
