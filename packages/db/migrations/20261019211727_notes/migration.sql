CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"author_name" text NOT NULL,
	"via_api_key_id" text,
	"via_connection_id" uuid,
	"via_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_record_idx" ON "notes" USING btree ("team_id","record_id","created_at");