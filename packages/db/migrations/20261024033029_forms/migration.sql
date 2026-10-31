CREATE TABLE "form_settings" (
	"team_id" text PRIMARY KEY NOT NULL,
	"captcha_provider" text DEFAULT 'builtin' NOT NULL,
	"turnstile_site_key" text,
	"turnstile_mode" text,
	"turnstile_secret" text,
	"block_disposable_emails" boolean DEFAULT false NOT NULL,
	"privacy_policy_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"email" text NOT NULL,
	"values" jsonb NOT NULL,
	"status" text NOT NULL,
	"spam_reason" text,
	"contact_id" uuid,
	"outcome" text,
	"page" text,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent" jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"confirm_ip" text,
	"confirm_user_agent" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_token_uses" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_versions_key" UNIQUE("form_id","version")
);
--> statement-breakpoint
CREATE TABLE "form_views" (
	"form_id" uuid NOT NULL,
	"day" text NOT NULL,
	"page" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "form_views_key" UNIQUE("form_id","day","page")
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"allowed_sites" jsonb,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_members" (
	"team_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"submission_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_members_key" UNIQUE("contact_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "kept" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "mode" text DEFAULT 'opt-out' NOT NULL;--> statement-breakpoint
ALTER TABLE "form_settings" ADD CONSTRAINT "form_settings_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_views" ADD CONSTRAINT "form_views_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_members" ADD CONSTRAINT "topic_members_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_members" ADD CONSTRAINT "topic_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_members" ADD CONSTRAINT "topic_members_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_email_idx" ON "form_submissions" USING btree ("team_id","email");--> statement-breakpoint
CREATE INDEX "forms_team_idx" ON "forms" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "topic_members_topic_idx" ON "topic_members" USING btree ("topic_id");