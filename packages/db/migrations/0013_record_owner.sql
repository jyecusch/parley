ALTER TABLE "companies" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_team_owner_idx" ON "companies" USING btree ("team_id","owner_id");--> statement-breakpoint
CREATE INDEX "contacts_team_owner_idx" ON "contacts" USING btree ("team_id","owner_id");