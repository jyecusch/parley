CREATE TABLE "affiliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliations_contact_id_company_id_key" UNIQUE("contact_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postcode" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "companies_team_id_id_key" UNIQUE("team_id","id")
);
--> statement-breakpoint
CREATE TABLE "company_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"is_primary" boolean NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "related_record_type" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "related_record_id" uuid;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "related_name" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_contact_fk" FOREIGN KEY ("team_id","contact_id") REFERENCES "public"."contacts"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_company_fk" FOREIGN KEY ("team_id","company_id") REFERENCES "public"."companies"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_domains" ADD CONSTRAINT "company_domains_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_domains" ADD CONSTRAINT "company_domains_company_fk" FOREIGN KEY ("team_id","company_id") REFERENCES "public"."companies"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliations_company_id_idx" ON "affiliations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "companies_team_id_updated_at_idx" ON "companies" USING btree ("team_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "company_domains_team_id_domain_key" ON "company_domains" USING btree ("team_id","domain") WHERE active;--> statement-breakpoint
CREATE INDEX "company_domains_company_id_idx" ON "company_domains" USING btree ("company_id");