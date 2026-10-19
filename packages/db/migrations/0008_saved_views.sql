CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"record_type" text NOT NULL,
	"name" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"owner_user_id" text,
	"owner_name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"sort" jsonb,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_views_team_id_idx" ON "saved_views" USING btree ("team_id","record_type");