import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Models that carry tenantId. Every query on these through tenantDb() is forced to the
 * caller's tenant — reads, updates and deletes get `tenantId` merged into `where`, creates
 * get it written into `data`. This is the application-level tenant isolation guarantee
 * (BRD §6). See docs/ARCHITECTURE.md for the optional Postgres RLS backstop.
 */
const TENANT_MODELS = new Set<string>([
  "Membership", "Role", "Branch", "Team", "Lead", "Contact", "Activity", "FollowUp",
  "AssignmentRule", "CallLog", "DndNumber", "PipelineStage", "Deal", "Product", "Quotation",
  "Invoice", "Payment", "Notification", "AuditLog", "ApiKey", "Webhook", "Automation",
  "AiUsage", "Ticket", "Workflow", "WorkflowRun", "MessageTemplate", "MessageLog", "Project", "Task",
  "ApprovalPolicy", "ApprovalRequest", "FileBlob", "Expense", "AttendanceRecord", "LeaveRequest",
  "CustomFieldDef", "CustomObject", "CustomRecord", "KnowledgeDoc", "Vendor", "PurchaseOrder", "StockMovement",
]);

type AnyArgs = Record<string, any>;

export function tenantDb(tenantId: string) {
  if (!tenantId) throw new Error("tenantDb requires a tenantId");
  return prisma.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as AnyArgs;
          switch (operation) {
            case "create":
              a.data = { ...a.data, tenantId };
              break;
            case "createMany":
            case "createManyAndReturn":
              a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: AnyArgs) => ({ ...d, tenantId }));
              break;
            case "upsert":
              a.where = { ...a.where, tenantId };
              a.create = { ...a.create, tenantId };
              break;
            default:
              // findUnique/update/delete use extended where-unique; all others plain where
              a.where = { ...(a.where ?? {}), tenantId };
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;

/** Atomic, gapless per-tenant counter (used for LD-0001, QT/2026-27/0001, INV/2026-27/0001). */
export async function nextNumber(tenantId: string, key: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ value: number }[]>(Prisma.sql`
    INSERT INTO "Counter" ("tenantId", "key", "value") VALUES (${tenantId}, ${key}, 1)
    ON CONFLICT ("tenantId", "key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`);
  return Number(rows[0].value);
}
