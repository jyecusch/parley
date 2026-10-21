ALTER TABLE "companies" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "employees" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "year_founded" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "annual_revenue" double precision;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "social_profiles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "social_profiles" text[] DEFAULT '{}'::text[] NOT NULL;