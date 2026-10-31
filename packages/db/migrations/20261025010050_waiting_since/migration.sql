ALTER TABLE "form_submissions" ADD COLUMN "waiting_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "form_submissions" SET "waiting_since" = "created_at";
