CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"reply_to" text,
	"legal_name" text NOT NULL,
	"postal_address" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "sender_id" uuid;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "senders_team_idx" ON "senders" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "senders_default_key" ON "senders" USING btree ("team_id") WHERE "senders"."is_default";--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;