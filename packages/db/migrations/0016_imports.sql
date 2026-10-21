CREATE TABLE "import_logos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"first_line" integer NOT NULL,
	"csv" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"record_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"file_name" text,
	"options" jsonb NOT NULL,
	"total_rows" integer NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"failed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logos_total" integer,
	"logos_done" integer DEFAULT 0 NOT NULL,
	"started_by_user_id" text,
	"started_by_name" text,
	"principal" jsonb NOT NULL,
	"error" text,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_logos" ADD CONSTRAINT "import_logos_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_logos" ADD CONSTRAINT "import_logos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_parts" ADD CONSTRAINT "import_parts_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_team_id_organization_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_started_by_user_id_user_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_logos_import_idx" ON "import_logos" USING btree ("import_id","line");--> statement-breakpoint
CREATE UNIQUE INDEX "import_parts_position_idx" ON "import_parts" USING btree ("import_id","position");--> statement-breakpoint
CREATE INDEX "imports_team_idx" ON "imports" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "imports_status_idx" ON "imports" USING btree ("status");