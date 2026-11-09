-- A distributor can be paid in several ways (CBD, TOP 30, TOP 60...), and an RFQ picks one of them. Payment terms move from the distributor
-- itself to a list of terms, and the RFQ keeps a copy of the one it chose. Existing data is carried over: each distributor's single type becomes its
-- first term, and each RFQ that names a distributor gets that distributor's type as its own.
CREATE TABLE "distributor_terms" (
    "id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "payment_type" "PaymentType" NOT NULL,
    "top_days" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "distributor_terms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "distributor_terms_distributor_id_payment_type_top_days_key" ON "distributor_terms"("distributor_id", "payment_type", "top_days");
ALTER TABLE "distributor_terms" ADD CONSTRAINT "distributor_terms_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Days belong to TOP only (1 to 365); every other type has 0. Both columns are NOT NULL, so no NULL can slip through the check.
ALTER TABLE "distributor_terms" ADD CONSTRAINT "distributor_terms_top_days_chk"
    CHECK (("payment_type" = 'TOP' AND "top_days" BETWEEN 1 AND 365) OR ("payment_type" <> 'TOP' AND "top_days" = 0));

INSERT INTO "distributor_terms" ("id", "distributor_id", "payment_type", "top_days", "position")
SELECT gen_random_uuid(), "id", "payment_type", COALESCE("top_days", 0), 0 FROM "distributors";

ALTER TABLE "requests" ADD COLUMN "payment_type" "PaymentType";
ALTER TABLE "requests" ADD COLUMN "top_days" INTEGER;
UPDATE "requests" r SET "payment_type" = d."payment_type", "top_days" = d."top_days" FROM "distributors" d WHERE r."distributor_id" = d."id";
-- Both empty, TOP with days, or another type without days. The IS NOT NULL is explicit: a NULL inside a CHECK counts as passing.
ALTER TABLE "requests" ADD CONSTRAINT "requests_payment_terms_chk" CHECK (
    ("payment_type" IS NULL AND "top_days" IS NULL)
    OR ("payment_type" IS NOT NULL AND "payment_type" = 'TOP' AND "top_days" IS NOT NULL AND "top_days" BETWEEN 1 AND 365)
    OR ("payment_type" IS NOT NULL AND "payment_type" IN ('CBD', 'COD') AND "top_days" IS NULL)
);

ALTER TABLE "distributors" DROP CONSTRAINT IF EXISTS "distributors_top_days_chk";
ALTER TABLE "distributors" DROP COLUMN "payment_type";
ALTER TABLE "distributors" DROP COLUMN "top_days";
