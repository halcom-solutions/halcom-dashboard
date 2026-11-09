-- Calculation and quotation (D-088): the "Project Approval" workbook as data, its configured approval steps, and the quotation in the shape
-- of Jurnal's Sales Quote; plus the items of a BOQ that SOA writes. Additive: two enums, six tables, no change to existing rows.
-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('PENDING', 'APPROVED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "rfq_request_id" UUID,
    "boq_request_id" UUID,
    "option_label" TEXT NOT NULL DEFAULT '',
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "tax_scheme" TEXT NOT NULL,
    "prepared_by_id" UUID NOT NULL,
    "config_snapshot" JSONB,
    "revenue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gross_margin" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gross_margin_bp" INTEGER,
    "customer_name" TEXT NOT NULL,
    "email" TEXT,
    "billing_address" TEXT,
    "transaction_date" DATE NOT NULL,
    "expiry_date" DATE,
    "payment_term" TEXT,
    "customer_reference" TEXT,
    "message" TEXT,
    "memo" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "returned_at" TIMESTAMPTZ(3),
    "returned_by_id" UUID,
    "returned_reason" TEXT,
    "chosen_at" TIMESTAMPTZ(3),
    "chosen_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "jurnal_quote_id" INTEGER,
    "jurnal_synced_at" TIMESTAMPTZ(3),
    "jurnal_order_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_approvals" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "step_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "acknowledge_label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "status" "ApprovalState" NOT NULL DEFAULT 'PENDING',
    "approver" JSONB NOT NULL,
    "may_edit_costs" BOOLEAN NOT NULL DEFAULT false,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "decided_by_pic_id" UUID,
    "note" TEXT,

    CONSTRAINT "quotation_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_lines" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "group_label" TEXT,
    "description" TEXT NOT NULL,
    "specification" TEXT,
    "category" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Unit',
    "sell_price" DECIMAL(18,2) NOT NULL,
    "buy_price" DECIMAL(18,2),
    "cost_description" TEXT,
    "distributor_id" UUID,
    "vendor_name" TEXT,
    "vendor_terms" TEXT,
    "cost_note" TEXT,

    CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_costs" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "quotation_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_terms" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "share_percent" DECIMAL(5,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "quotation_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_items" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "group_label" TEXT,
    "name" TEXT NOT NULL,
    "specification" TEXT,
    "category_label" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'Unit',
    "quantity" DECIMAL(12,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotations_number_key" ON "quotations"("number");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_jurnal_quote_id_key" ON "quotations"("jurnal_quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_jurnal_order_id_key" ON "quotations"("jurnal_order_id");

-- CreateIndex
CREATE INDEX "quotations_project_id_idx" ON "quotations"("project_id");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE INDEX "quotations_prepared_by_id_idx" ON "quotations"("prepared_by_id");

-- CreateIndex
CREATE INDEX "quotations_rfq_request_id_idx" ON "quotations"("rfq_request_id");

-- CreateIndex
CREATE INDEX "quotations_boq_request_id_idx" ON "quotations"("boq_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_approvals_quotation_id_position_key" ON "quotation_approvals"("quotation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_approvals_quotation_id_step_key_key" ON "quotation_approvals"("quotation_id", "step_key");

-- CreateIndex
CREATE INDEX "quotation_lines_distributor_id_idx" ON "quotation_lines"("distributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_lines_quotation_id_position_key" ON "quotation_lines"("quotation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_costs_quotation_id_position_key" ON "quotation_costs"("quotation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_terms_quotation_id_position_key" ON "quotation_terms"("quotation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "request_items_request_id_position_key" ON "request_items"("request_id", "position");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rfq_request_id_fkey" FOREIGN KEY ("rfq_request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_boq_request_id_fkey" FOREIGN KEY ("boq_request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_prepared_by_id_fkey" FOREIGN KEY ("prepared_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_returned_by_id_fkey" FOREIGN KEY ("returned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_chosen_by_id_fkey" FOREIGN KEY ("chosen_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_approvals" ADD CONSTRAINT "quotation_approvals_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_approvals" ADD CONSTRAINT "quotation_approvals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_approvals" ADD CONSTRAINT "quotation_approvals_decided_by_pic_id_fkey" FOREIGN KEY ("decided_by_pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_costs" ADD CONSTRAINT "quotation_costs_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_terms" ADD CONSTRAINT "quotation_terms_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Numbers as Jurnal writes them: QUO-<yy>-<mm>-<running count of five digits or more>.
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_number_format_chk" CHECK ("number" ~ '^QUO-[0-9]{2}-[0-9]{2}-[0-9]{5,}$');
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_name_chk" CHECK (btrim("customer_name") <> '');
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_expiry_chk" CHECK ("expiry_date" IS NULL OR "expiry_date" >= "transaction_date");
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tax_scheme_chk" CHECK ("tax_scheme" ~ '^[A-Z][A-Z0-9_]{0,29}$');

-- A quotation under approval or approved carries the rules it was submitted with; approved and cancelled carry their moment.
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_submitted_chk" CHECK ("status" IN ('DRAFT', 'CANCELLED') OR ("submitted_at" IS NOT NULL AND "config_snapshot" IS NOT NULL));
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_approved_chk" CHECK ("status" <> 'APPROVED' OR "approved_at" IS NOT NULL);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_cancelled_chk" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);

-- Only an approved quotation can be the option the customer chose, and a project has at most one chosen option.
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_chosen_chk" CHECK ("chosen_at" IS NULL OR "status" = 'APPROVED');
CREATE UNIQUE INDEX "quotations_one_chosen_per_project" ON "quotations"("project_id") WHERE "chosen_at" IS NOT NULL;

-- A decision has a moment and a person; a step that is only told is acknowledged, never approved.
ALTER TABLE "quotation_approvals" ADD CONSTRAINT "quotation_approvals_decision_chk" CHECK (
    ("status" = 'PENDING' AND "decided_at" IS NULL AND "decided_by_id" IS NULL)
    OR ("status" <> 'PENDING' AND "decided_at" IS NOT NULL AND "decided_by_id" IS NOT NULL));
ALTER TABLE "quotation_approvals" ADD CONSTRAINT "quotation_approvals_kind_chk" CHECK (("required" AND "status" <> 'ACKNOWLEDGED') OR (NOT "required" AND "status" <> 'APPROVED'));
ALTER TABLE "quotation_approvals" ADD CONSTRAINT "quotation_approvals_position_chk" CHECK ("position" >= 1);

-- The approval rule, kept by the database whatever code writes the rows: a quotation becomes APPROVED only when it has approval steps
-- and every step that must approve has approved. Deferred to the end of the transaction, so the steps and the status can be written in
-- either order.
CREATE FUNCTION "quotations_require_approvals"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."status" = 'APPROVED' THEN
        IF NOT EXISTS (SELECT 1 FROM "quotation_approvals" a WHERE a."quotation_id" = NEW."id" AND a."required") THEN
            RAISE EXCEPTION 'quotation % cannot be approved without a required approval step', NEW."number" USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM "quotation_approvals" a WHERE a."quotation_id" = NEW."id" AND a."required" AND a."status" <> 'APPROVED') THEN
            RAISE EXCEPTION 'quotation % has a required approval step still open', NEW."number" USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "quotations_require_approvals_trg" AFTER INSERT OR UPDATE OF "status" ON "quotations"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "quotations_require_approvals"();

ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_values_chk" CHECK (
    "position" >= 1 AND btrim("description") <> '' AND "quantity" > 0 AND "sell_price" >= 0 AND ("buy_price" IS NULL OR "buy_price" >= 0)
    AND "category" ~ '^[A-Z][A-Z0-9_]{0,29}$');
ALTER TABLE "quotation_costs" ADD CONSTRAINT "quotation_costs_values_chk" CHECK ("position" >= 1 AND "amount" >= 0);
ALTER TABLE "quotation_terms" ADD CONSTRAINT "quotation_terms_values_chk" CHECK ("position" >= 1 AND "share_percent" BETWEEN 0 AND 100);
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_values_chk" CHECK ("position" >= 1 AND btrim("name") <> '' AND "quantity" > 0);
