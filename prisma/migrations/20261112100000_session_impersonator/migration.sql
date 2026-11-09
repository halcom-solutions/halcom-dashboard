-- A session opened by a superadmin to see the application as another account ("view as"). It belongs to the viewed account and names who opened it.
ALTER TABLE "sessions" ADD COLUMN "impersonator_id" UUID;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonator_id_fkey" FOREIGN KEY ("impersonator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
