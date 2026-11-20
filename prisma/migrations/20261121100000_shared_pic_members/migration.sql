-- D-100: a shared PIC (such as "Soraya & Gita") is worked by several accounts together. Additive: no row changes.
-- A request handed to the shared PIC is each member's work; the requests keep naming the PIC, so nothing is rewritten.
CREATE TABLE "pic_members" (
    "pic_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pic_members_pkey" PRIMARY KEY ("pic_id","user_id")
);

CREATE INDEX "pic_members_user_id_idx" ON "pic_members"("user_id");

ALTER TABLE "pic_members" ADD CONSTRAINT "pic_members_pic_id_fkey" FOREIGN KEY ("pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pic_members" ADD CONSTRAINT "pic_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
