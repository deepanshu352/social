"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Sparkles, Send } from "lucide-react";

type Tpl = { id: string; name: string; channel: string };

/** Omnichannel composer on lead / customer pages: template or free text, live preview, AI draft. */
export function SendMessage({ leadId, contactId, templates, aiOn }: { leadId?: string; contactId?: string; templates: Tpl[]; aiOn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState("whatsapp");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(url: string, payload: object) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message ?? "Failed");
    return j;
  }
  async function useTemplate(id: string) {
    setTemplateId(id);
    if (!id) return;
    setBusy("preview");
    try { const j = await call("/api/messages?preview=1", { channel, templateId: id, leadId, contactId }); setSubject(j.subject ?? ""); setBody(j.body); setTemplateId(""); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }
  async function aiDraft() {
    setBusy("ai"); setMsg(null);
    try { const j = await call("/api/ai/draft", { channel, purpose: purpose || "friendly follow-up on their enquiry", leadId, contactId }); if (j.subject) setSubject(j.subject); setBody(j.body); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }
  async function sendNow() {
    setBusy("send"); setMsg(null);
    try {
      const j = await call("/api/messages", { channel, subject, body, leadId, contactId });
      setMsg({ ok: j.status !== "failed" && j.status !== "blocked", text: j.status === "simulated" ? "Logged (no provider configured — simulated send)." : j.status === "sent" ? "Sent ✓" : `${j.status}: ${j.error ?? ""}` });
      if (j.status !== "failed" && j.status !== "blocked") { setBody(""); setSubject(""); router.refresh(); }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="btn-secondary w-full"><MessageSquare size={15} /> Send WhatsApp / email / SMS</button>;
  return (
    <div className="card card-pad space-y-2.5">
      <div className="flex items-center justify-between"><div className="text-sm font-semibold">Send message</div><button onClick={() => setOpen(false)} className="text-xs text-muted">Close</button></div>
      <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-xs">
        {["whatsapp", "email", "sms"].map((c) => <button key={c} type="button" onClick={() => setChannel(c)} className={`flex-1 rounded-md px-2 py-1 capitalize ${channel === c ? "bg-white font-medium shadow-sm" : "text-muted"}`}>{c === "whatsapp" ? "WhatsApp" : c}</button>)}
      </div>
      <select value={templateId} onChange={(e) => useTemplate(e.target.value)} className="input py-1.5 text-sm">
        <option value="">Insert template…</option>{templates.filter((t) => t.channel === channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {aiOn && (
        <div className="flex gap-2"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="AI: what should it say?" className="input py-1.5 text-sm" />
          <button type="button" onClick={aiDraft} disabled={!!busy} className="btn-secondary btn-sm"><Sparkles size={13} className="text-fuchsia-600" />{busy === "ai" ? "…" : "Draft"}</button></div>
      )}
      {channel === "email" && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="input py-1.5 text-sm" />}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Message" className="input text-sm" />
      <button onClick={sendNow} disabled={!body.trim() || !!busy} className="btn-primary w-full"><Send size={14} />{busy === "send" ? "Sending…" : "Send"}</button>
      {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">Opted-out and DND numbers are blocked automatically. Every message is logged on the timeline.</p>
    </div>
  );
}
