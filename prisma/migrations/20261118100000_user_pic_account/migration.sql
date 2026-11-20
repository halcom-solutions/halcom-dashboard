-- D-097: a PIC can have its own account (tried on SOA first: Adityo and Ibnu). Additive: no row changes, the shared login keeps working.
-- The requests and projects already name the PIC (requests.pic_id, requests.raised_by_pic_id, projects.soa_pic_id), so linking an account
-- to a PIC is the whole migration of the existing work: the account sees it at once.
ALTER TABLE "users" ADD COLUMN "pic_id" UUID;

CREATE UNIQUE INDEX "users_pic_id_key" ON "users"("pic_id");

ALTER TABLE "users" ADD CONSTRAINT "users_pic_id_fkey" FOREIGN KEY ("pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
