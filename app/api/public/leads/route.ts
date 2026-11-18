import { authenticateApiKey } from "@/lib/apikey";
import { createLead } from "@/lib/leads";
import { json, jsonError } from "@/lib/api";

/**
 * Website / landing-page form capture. Accepts JSON or form-encoded posts.
 * Auth: ?key=bos_live_… (use a dedicated key — it can only create leads) or Authorization header.
 * Optional ?redirect=https://yoursite/thanks for plain HTML forms.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const keyParam = url.searchParams.get("key");
  const authReq = keyParam ? new Request(req.url, { headers: { authorization: `Bearer ${keyParam}` } }) : req;
  const auth = await authenticateApiKey(authReq);
  if ("error" in auth) return jsonError("UNAUTHORIZED", auth.error!, auth.status);
  const ct = req.headers.get("content-type") ?? "";
  const body: Record<string, string> = ct.includes("application/json") ? await req.json() : Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  if (body.website_url) return json({ ok: true }); // honeypot field for bots
  if (!body.name) return jsonError("VALIDATION", "name is required", 422);
  await createLead(auth.tenant.id, {
    name: body.name, phone: body.phone, email: body.email, companyName: body.company, city: body.city, product: body.product, notes: body.message,
    source: body.source || "website", campaign: body.utm_campaign || body.campaign,
  }, { name: `Web form (${auth.key.name})`, type: "api_key" });
  const redirect = url.searchParams.get("redirect");
  if (redirect?.startsWith("https://")) return Response.redirect(redirect, 303);
  return json({ ok: true }, 201);
}
