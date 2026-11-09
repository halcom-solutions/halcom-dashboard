-- Distributor master data kept by Purchasing, and the distributor an RFQ is sent to. Additive: one enum, one table, one nullable column on requests.
CREATE TYPE "PaymentType" AS ENUM ('CBD', 'COD', 'TOP');

CREATE TABLE "distributors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "alias" TEXT,
    "payment_type" "PaymentType" NOT NULL,
    "top_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "distributors_name_key_key" ON "distributors"("name_key");

-- The key is the trimmed, single-spaced, lower-cased name, whatever code writes the row.
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_name_key_chk"
    CHECK ("name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')) AND "name_key" <> '');

-- Days of credit belong to TOP only, and TOP needs them. IS NOT NULL is explicit: a NULL inside a CHECK counts as passing.
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_top_days_chk"
    CHECK (("payment_type" = 'TOP' AND "top_days" IS NOT NULL AND "top_days" BETWEEN 1 AND 365) OR ("payment_type" <> 'TOP' AND "top_days" IS NULL));

ALTER TABLE "requests" ADD COLUMN "distributor_id" UUID;
CREATE INDEX "requests_distributor_id_idx" ON "requests"("distributor_id");
ALTER TABLE "requests" ADD CONSTRAINT "requests_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
