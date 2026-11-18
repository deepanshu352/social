import { json, jsonError } from "@/lib/api";
import { tick } from "@/lib/workflows";

/** Call every minute (Vercel Cron / k8s CronJob / GitHub Actions) with Authorization: Bearer $CRON_SECRET. */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return jsonError("UNAUTHORIZED", "Bad cron secret", 401);
  const force = new URL(req.url).searchParams.get("force") === "1";
  return json(await tick({ force }));
}
