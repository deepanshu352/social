import type { ActionType, Cond, Step } from "./workflows";

/** Ready-made automations (BRD §61). One click installs a fully editable copy. */
export type Recipe = { key: string; name: string; category: string; description: string; trigger: string; triggerConfig?: Record<string, unknown>; conditions?: Cond[]; steps: Step[]; industries?: string[] };

let n = 0;
const id = () => `r${++n}`;
const act = (action: ActionType, config: Record<string, unknown> = {}): Step => ({ id: id(), type: "action", action, config });
const wait = (amount: number, unit: "minutes" | "hours" | "days"): Step => ({ id: id(), type: "wait", amount, unit });
const when = (conditions: Cond[], then: Step[], otherwise: Step[] = []): Step => ({ id: id(), type: "condition", match: "all", conditions, then, else: otherwise });
const UNPAID: Cond = { field: "invoice.status", op: "in", value: "issued,partially_paid,overdue" };

export const RECIPES: Recipe[] = [
  {
    key: "speed_to_lead", name: "Speed-to-lead: call within 15 minutes", category: "Leads",
    description: "Welcome the lead on WhatsApp, schedule a call in 15 minutes, and escalate to the manager if nobody has called within 2 hours.",
    trigger: "lead.created",
    steps: [
      act("send_message", { channel: "whatsapp", body: "Namaste {{lead.first_name}} 🙏 Thanks for your enquiry with {{company.name}}. {{owner.name}} will call you in a few minutes." }),
      act("create_followup", { inHours: 0.25, note: "First call — new lead", assignTo: "owner" }),
      wait(2, "hours"),
      when([{ field: "lead.calls_since_start", op: "eq", value: "0" }], [
        act("notify", { to: "manager", title: "Lead not called in 2 hours: {{lead.name}}", body: "{{owner.name}} hasn't called {{lead.number}} yet." }),
        act("update_lead", { field: "priority", value: "urgent" }),
      ]),
    ],
  },
  {
    key: "idle_nurture", name: "Re-engage idle leads", category: "Leads",
    description: "When a lead has had no activity for 3 days: send a check-in, wait 2 days, and if still no connected call, tag it and hand it to the next available rep.",
    trigger: "lead.idle", triggerConfig: { days: 3 },
    steps: [
      act("send_message", { channel: "whatsapp", body: "Hi {{lead.first_name}}, just checking in about {{lead.product}}. Would you like the latest price list? Reply here — {{company.name}}" }),
      wait(2, "days"),
      when([{ field: "lead.connected_since_start", op: "eq", value: "0" }], [
        act("add_tag", { tag: "re-engaged" }),
        act("assign_lead", { mode: "rules" }),
        act("create_followup", { inHours: 1, note: "Re-assigned idle lead — call today", assignTo: "owner" }),
      ]),
    ],
  },
  {
    key: "referral_fast_lane", name: "Referral leads → high priority", category: "Leads",
    description: "Referral leads convert best. Mark them high priority, tag them, and alert the owner immediately.",
    trigger: "lead.created", conditions: [{ field: "lead.source", op: "eq", value: "referral" }],
    steps: [act("update_lead", { field: "priority", value: "high" }), act("add_tag", { tag: "referral" }), act("notify", { to: "owner", title: "🔥 Referral lead: {{lead.name}}", body: "Call within 30 minutes." })],
  },
  {
    key: "ai_qualify", name: "AI qualifies every new lead", category: "AI",
    description: "Claude reads the enquiry, writes a qualification note with likely intent and objections, and drafts the first message for the rep.",
    trigger: "lead.created", steps: [act("ai_qualify_lead")],
  },
  {
    key: "missed_followup", name: "Recover missed follow-ups", category: "Calling",
    description: "When a follow-up is missed, remind the owner and reschedule it 2 hours later.",
    trigger: "followup.missed",
    steps: [act("notify", { to: "owner", title: "Missed follow-up: {{lead.name}}", body: "Rescheduled for 2 hours from now." }), act("create_followup", { inHours: 2, note: "Rescheduled after missed follow-up", assignTo: "owner" })],
  },
  {
    key: "quote_followup", name: "Chase quotations not yet accepted", category: "Sales",
    description: "Two days after sending, nudge the customer on WhatsApp with the acceptance link and give the rep a call task.",
    trigger: "quotation.pending", triggerConfig: { days: 2 },
    steps: [
      act("send_message", { channel: "whatsapp", body: "Hi {{contact.first_name}}, a gentle reminder about quotation {{quotation.number}} ({{quotation.total}}), valid till {{quotation.valid_until}}. View & accept: {{quotation.link}}" }),
      act("create_task", { title: "Call {{contact.name}} to close {{quotation.number}}", dueInHours: 24, assignTo: "owner", priority: "high" }),
    ],
  },
  {
    key: "deal_won_onboarding", name: "Deal won → onboarding", category: "Sales",
    description: "Thank the customer by email and create a kick-off task for the owner.",
    trigger: "deal.won",
    steps: [
      act("send_message", { channel: "email", subject: "Welcome to {{company.name}}", body: "Dear {{contact.name}},\n\nThank you for choosing {{company.name}}. Our team will reach out to schedule the kick-off.\n\nRegards,\n{{company.name}}" }),
      act("create_task", { title: "Kick-off / onboarding call with {{contact.name}}", dueInHours: 48, assignTo: "owner", priority: "high" }),
    ],
  },
  {
    key: "pre_due_reminder", name: "Payment reminder before due date", category: "Finance",
    description: "Three days before an invoice falls due, send the customer a WhatsApp reminder with the payment link.",
    trigger: "invoice.due_soon", triggerConfig: { days: 3 },
    steps: [act("send_message", { channel: "whatsapp", body: "Hi {{contact.first_name}}, invoice {{invoice.number}} for {{invoice.balance}} is due on {{invoice.due_date}}. Pay or download: {{invoice.link}} — {{company.name}}" })],
  },
  {
    key: "collections", name: "Overdue collection sequence", category: "Finance",
    description: "Day 0 email → day 3 WhatsApp + owner alert → day 7 escalate to manager and create an accounts task. Stops automatically once paid.",
    trigger: "invoice.overdue",
    steps: [
      act("send_message", { channel: "email", subject: "Overdue: invoice {{invoice.number}}", body: "Dear {{contact.name}},\n\nInvoice {{invoice.number}} ({{invoice.balance}}) was due on {{invoice.due_date}}. Please arrange payment: {{invoice.link}}\n\nRegards,\nAccounts, {{company.name}}" }),
      wait(3, "days"),
      when([UNPAID], [
        act("send_message", { channel: "whatsapp", body: "Hi {{contact.first_name}}, invoice {{invoice.number}} ({{invoice.balance}}) is now {{invoice.days_overdue}} days overdue. Pay here: {{invoice.link}}" }),
        act("notify", { to: "owner", title: "Overdue {{invoice.days_overdue}} days: {{invoice.number}}", body: "{{contact.name}} · {{invoice.balance}}" }),
        wait(4, "days"),
        when([UNPAID], [
          act("escalate", { note: "Invoice {{invoice.number}} ({{invoice.balance}}) is {{invoice.days_overdue}} days overdue." }),
          act("create_task", { title: "Collections call: {{contact.name}} · {{invoice.number}}", dueInHours: 24, assignTo: "role:accountant", priority: "urgent" }),
        ]),
      ]),
    ],
  },
  {
    key: "thank_you_payment", name: "Thank customers for large payments", category: "Finance",
    description: "Send a thank-you WhatsApp when a payment of ₹1,00,000 or more arrives.",
    trigger: "payment.received", conditions: [{ field: "event.amount", op: "gte", value: "100000" }],
    steps: [act("send_message", { channel: "whatsapp", body: "Thank you {{contact.first_name}}! We've received your payment. It's a pleasure doing business with you — {{company.name}}" })],
  },
  {
    key: "win_back", name: "Win back inactive customers", category: "Customers",
    description: "Customers who haven't bought in 90 days get a win-back message and the owner gets a reactivation call task (once a month per customer).",
    trigger: "customer.inactive", triggerConfig: { days: 90 },
    steps: [
      act("send_message", { channel: "whatsapp", body: "Hi {{contact.first_name}}, it's been a while! {{company.name}} has new stock and special rates this month. Reply YES for the latest price list." }),
      act("create_task", { title: "Reactivation call: {{contact.name}}", dueInHours: 72, assignTo: "owner" }),
    ],
  },
  {
    key: "ai_ticket_triage", name: "AI ticket triage + acknowledgement", category: "Support",
    description: "Claude categorises and prioritises each new ticket and drafts a reply; the customer gets an instant acknowledgement email.",
    trigger: "ticket.created",
    steps: [act("ai_triage_ticket"), act("send_message", { channel: "email", subject: "We received your request {{ticket.number}}", body: "Hi {{contact.first_name}},\n\nWe've logged \"{{ticket.subject}}\" as {{ticket.number}} and will update you soon.\n\n{{company.name}} Support" })],
  },
  {
    key: "sla_escalation", name: "Escalate tickets that breach SLA", category: "Support",
    description: "When a ticket passes its SLA due time, raise it to urgent and alert the manager.",
    trigger: "ticket.sla_breach", steps: [act("escalate", { note: "Ticket {{ticket.number}} “{{ticket.subject}}” has breached its SLA." })],
  },
  {
    key: "overdue_tasks", name: "Nudge overdue tasks", category: "Work",
    description: "Remind the assignee when a task passes its due date; escalate if still open a day later.",
    trigger: "task.overdue",
    steps: [act("notify", { to: "owner", title: "Overdue task: {{event.taskId}}", body: "Please update or complete it." }), wait(1, "days"),
      when([{ field: "task.status", op: "neq", value: "done" }], [act("notify", { to: "manager", title: "Task overdue for over a day", body: "Assignee hasn't completed it." })])],
  },
  {
    key: "low_stock", name: "Low stock → reorder task", category: "Inventory",
    description: "When stock drops below the minimum, alert admins and create a purchase task.",
    trigger: "stock.low",
    steps: [act("notify", { to: "role:admin", title: "Low stock: {{event.name}}", body: "Only {{event.stock}} left (minimum {{event.minStock}})." }), act("create_task", { title: "Raise purchase order for {{event.name}}", dueInHours: 24, assignTo: "role:accountant", priority: "high" })],
    industries: ["distributor", "manufacturer", "retail", "ecommerce"],
  },
  {
    key: "expense_alert", name: "Large expense alert", category: "People",
    description: "Notify accounts when an expense of ₹5,000 or more is submitted.",
    trigger: "expense.submitted", conditions: [{ field: "event.amount", op: "gte", value: "5000" }],
    steps: [act("notify", { to: "role:accountant", title: "Expense claim {{event.amount}} submitted", body: "Review in Approvals." })],
  },
  {
    key: "leave_alert", name: "Leave request → notify manager", category: "People",
    description: "Managers are notified as soon as a team member applies for leave.",
    trigger: "leave.requested", steps: [act("notify", { to: "manager", title: "Leave request: {{event.name}}", body: "{{event.days}} day(s) of {{event.type}} leave. Review in Approvals." })],
  },
  {
    key: "daily_digest", name: "Morning digest for owners (9 AM)", category: "Schedule",
    description: "Every morning: leads, calls, collections, overdue invoices, missed follow-ups and SLA breaches — in-app and by email.",
    trigger: "schedule.daily", triggerConfig: { time: "09:00" }, steps: [act("send_digest", { to: "role:admin", email: true })],
  },
  {
    key: "weekly_review", name: "Weekly pipeline review (Monday)", category: "Schedule",
    description: "Every Monday at 10 AM, create a pipeline-review task for each sales manager.",
    trigger: "schedule.weekly", triggerConfig: { weekday: 1, time: "10:00" },
    steps: [act("create_task", { title: "Weekly pipeline review", dueInHours: 8, assignTo: "role:sales_manager", priority: "high", description: "Review stuck deals, quotations awaiting acceptance and overdue follow-ups." })],
  },
];
