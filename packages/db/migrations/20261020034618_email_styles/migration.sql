CREATE TABLE "email_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"file_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_styles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"layout" text DEFAULT 'plain' NOT NULL,
	"logo_key" text,
	"logo_align" text DEFAULT 'left' NOT NULL,
	"header_text" text,
	"colors" jsonb NOT NULL,
	"font" text DEFAULT 'default' NOT NULL,
	"custom_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "style_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "style_id" uuid;--> statement-breakpoint
ALTER TABLE "email_images" ADD CONSTRAINT "email_images_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_styles" ADD CONSTRAINT "email_styles_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_images_team_idx" ON "email_images" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "email_styles_team_idx" ON "email_styles" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_styles_default_key" ON "email_styles" USING btree ("team_id") WHERE "email_styles"."is_default";--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_style_id_email_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."email_styles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_style_id_email_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."email_styles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Every existing team starts with the plain look as its default (D115, D116).
INSERT INTO "email_styles" ("id", "team_id", "name", "is_default", "layout", "colors", "font")
SELECT gen_random_uuid(), "id", 'Plain', true, 'plain',
  '{"text":"#1A1A1A","background":"#FFFFFF","link":"#1A0DAB","button":"#1A1A1A","buttonText":"#FFFFFF"}'::jsonb, 'default'
FROM "organization";
