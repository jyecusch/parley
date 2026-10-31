CREATE TABLE "files" (
	"key" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"content_type" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;