CREATE TABLE "broadcast_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"payload" text NOT NULL,
	"provider_identity" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD COLUMN "batch_position" integer;--> statement-breakpoint
ALTER TABLE "broadcast_batches" ADD CONSTRAINT "broadcast_batches_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_batches" ADD CONSTRAINT "broadcast_batches_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_batches_due_idx" ON "broadcast_batches" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_batch_id_broadcast_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."broadcast_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_sending_idx" ON "broadcasts" USING btree ("team_id") WHERE "broadcasts"."status" = 'sending';--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_batch_position_key" UNIQUE("batch_id","batch_position");
--> statement-breakpoint
-- Old workers had no durable provider key; replaying an attempted recipient could send it twice.
UPDATE "broadcast_recipients" SET "status" = 'unknown', "next_attempt_at" = NULL,
  "error" = 'The email service may have accepted this email before the delivery upgrade. Automatic retries stopped to avoid sending it twice.',
  "updated_at" = now()
WHERE "status" = 'queued' AND "attempts" > 0;
