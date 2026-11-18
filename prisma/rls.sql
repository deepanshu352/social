-- Optional defence-in-depth: Postgres Row-Level Security on every tenant table.
-- The app already enforces tenant isolation in lib/db.ts (tenantDb). RLS is the backstop for
-- raw SQL, reporting users and future services. To use it:
--   1. run this file (npm run db:rls)
--   2. connect the app as a role WITHOUT BYPASSRLS (not the table owner / superuser)
--   3. in tenantDb(), wrap each request in a transaction that runs
--        SELECT set_config('app.tenant_id', $tenantId, true)
--   Platform/cron code connects with a separate role that has BYPASSRLS.
DO $$
DECLARE t text;
BEGIN
  -- All 46 tenant-scoped models with direct tenantId column
  FOREACH t IN ARRAY ARRAY[
    'Session', 'Membership', 'Role', 'Branch', 'Team', 'Counter',
    'Lead', 'Contact', 'Activity', 'FollowUp', 'AssignmentRule',
    'CallLog', 'DndNumber', 'PipelineStage', 'Deal', 'Product',
    'Quotation', 'Invoice', 'Payment', 'Ticket', 'Notification',
    'AuditLog', 'ApiKey', 'Webhook', 'Automation', 'AiUsage',
    'Workflow', 'WorkflowRun', 'MessageTemplate', 'MessageLog',
    'Project', 'Task', 'ApprovalPolicy', 'ApprovalRequest', 'FileBlob',
    'Expense', 'AttendanceRecord', 'LeaveRequest', 'CustomFieldDef',
    'CustomObject', 'CustomRecord', 'KnowledgeDoc', 'Vendor',
    'PurchaseOrder', 'StockMovement', 'LoginEvent'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))$p$, t);
  END LOOP;

  -- Child tables without direct tenantId (scoped via parent relations)
  EXECUTE 'ALTER TABLE "QuotationItem" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "QuotationItem"';
  EXECUTE $p$CREATE POLICY tenant_isolation ON "QuotationItem" USING (
    EXISTS (SELECT 1 FROM "Quotation" q WHERE q.id = "quotationId" AND q."tenantId" = current_setting('app.tenant_id', true))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM "Quotation" q WHERE q.id = "quotationId" AND q."tenantId" = current_setting('app.tenant_id', true))
  )$p$;

  EXECUTE 'ALTER TABLE "InvoiceItem" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "InvoiceItem"';
  EXECUTE $p$CREATE POLICY tenant_isolation ON "InvoiceItem" USING (
    EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId" AND i."tenantId" = current_setting('app.tenant_id', true))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId" AND i."tenantId" = current_setting('app.tenant_id', true))
  )$p$;
END $$;
