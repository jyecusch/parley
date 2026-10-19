CREATE TABLE "team_settings" (
	"team_id" text PRIMARY KEY NOT NULL,
	"gravatar" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;