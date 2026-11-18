import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { authorize, guard, hasModule } from "@/lib/auth";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { generateKey } from "@/lib/apikey";
import { EVENT_TYPES } from "@/lib/events";
import { audit } from "@/lib/audit";
import { fmtDate, str, timeAgo } from "@/lib/utils";
import { guarded } from "@/lib/action";

export const metadata = { title: "API & webhooks" };

async function createKey(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("api.manage", { mod: "api" });
  const { key, prefix, hash } = generateKey();
  const k = await ctx.db.apiKey.create({ data: { tenantId: ctx.tenant.id, name: str(fd.get("name")) || "API key", prefix, keyHash: hash } });
  await audit(ctx, "apikey.create", "ApiKey", k.id, null, { name: k.name, prefix });
  await ctx.db.notification.create({ data: { tenantId: ctx.tenant.id, membershipId: ctx.membership.id, title: `New API key “${k.name}” — copy it now`, body: key } });
  revalidatePath("/settings/api");
});
}
async function revokeKey(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("api.manage");
  await ctx.db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(ctx, "apikey.revoke", "ApiKey", id);
  revalidatePath("/settings/api");
});
}
async function addHook(fd: FormData) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("api.manage", { mod: "api" });
  const url = str(fd.get("url"));
  if (!/^https:\/\//.test(url)) throw new Error("Webhook URL must use https://");
  const events = fd.getAll("events").map(String);
  if (!events.length) throw new Error("Pick at least one event");
  const h = await ctx.db.webhook.create({ data: { tenantId: ctx.tenant.id, url, events, secret: `whsec_${crypto.randomBytes(18).toString("hex")}` } });
  await audit(ctx, "webhook.create", "Webhook", h.id, null, { url, events });
  revalidatePath("/settings/api");
});
}
async function removeHook(id: string) {
  "use server";
  return guarded(async () => {
  const ctx = await authorize("api.manage");
  await ctx.db.webhook.delete({ where: { id } });
  revalidatePath("/settings/api");
});
}

export default async function ApiSettings() {
  const ctx = await guard("api.manage");
  const enabled = hasModule(ctx, "api");
  const [keys, hooks] = await Promise.all([ctx.db.apiKey.findMany({ orderBy: { createdAt: "desc" } }), ctx.db.webhook.findMany({ orderBy: { createdAt: "desc" } })]);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return (
    <>
      <PageHeader title="API & webhooks" subtitle={enabled ? "REST API v1 with bearer API keys, 120 requests/min per key." : "API access is included in the Professional plan."} />
      <div className="space-y-6">
        <Card title="API keys" pad={false}>
          {keys.length ? <table className="table"><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead>
            <tbody>{keys.map((k) => <tr key={k.id}><td>{k.name}</td><td className="font-mono text-xs">{k.prefix}…</td><td>{fmtDate(k.createdAt)}</td><td>{timeAgo(k.lastUsedAt)}</td>
              <td>{k.revokedAt ? <Badge tone="red">Revoked</Badge> : <form action={revokeKey.bind(null, k.id)}><SubmitButton className="btn-ghost btn-sm text-red-700" confirm="Revoke this key? Integrations using it will stop.">Revoke</SubmitButton></form>}</td></tr>)}</tbody></table>
            : <Empty title="No API keys" />}
          {enabled && <form action={createKey} className="flex gap-2 border-t border-line p-4"><input name="name" placeholder="Key name, e.g. Website form" className="input max-w-xs" /><SubmitButton>Create key</SubmitButton><span className="self-center text-xs text-muted">The full key is shown once, in your notifications.</span></form>}
        </Card>

        <Card title="Webhooks" pad={false}>
          {hooks.length ? <table className="table"><thead><tr><th>URL</th><th>Events</th><th>Signing secret</th><th>Last delivery</th><th></th></tr></thead>
            <tbody>{hooks.map((h) => <tr key={h.id}><td className="max-w-xs truncate font-mono text-xs">{h.url}</td><td className="text-xs">{h.events.join(", ")}</td><td className="font-mono text-xs">{h.secret.slice(0, 12)}…</td>
              <td>{h.lastSentAt ? <>{timeAgo(h.lastSentAt)} · <Badge tone={h.lastStatus && h.lastStatus < 300 ? "green" : "red"}>{h.lastStatus || "failed"}</Badge></> : "—"}</td>
              <td><form action={removeHook.bind(null, h.id)}><SubmitButton className="btn-ghost btn-sm">Remove</SubmitButton></form></td></tr>)}</tbody></table>
            : <Empty title="No webhooks" />}
          {enabled && (
            <form action={addHook} className="space-y-3 border-t border-line p-4">
              <input name="url" required placeholder="https://example.com/hooks/bizos" className="input" />
              <div className="flex flex-wrap gap-3 text-sm">{EVENT_TYPES.map((e) => <label key={e} className="flex items-center gap-1.5"><input type="checkbox" name="events" value={e} /> <code className="text-xs">{e}</code></label>)}</div>
              <SubmitButton>Add webhook</SubmitButton>
            </form>
          )}
        </Card>

        <Card title="Quick reference">
          <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">{`# List leads
curl ${base}/api/v1/leads?limit=20 -H "Authorization: Bearer bos_live_…"

# Create a lead (runs assignment rules, scoring and automations)
curl -X POST ${base}/api/v1/leads -H "Authorization: Bearer bos_live_…" \\
  -H "content-type: application/json" \\
  -d '{"name":"Rahul Verma","phone":"9876543210","source":"website","city":"Delhi","product":"Steel pipes"}'

# Other endpoints: GET /api/v1/contacts  GET /api/v1/invoices?status=overdue  GET /api/v1/deals

# Webhook signature: X-BizOS-Signature = "sha256=" + HMAC_SHA256(secret, raw_body)`}</pre>
        </Card>
      </div>
    </>
  );
}
