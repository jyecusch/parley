-- D153, D154: click IDs on submissions, and where a sign-up came from on its activity. Forms keep the old captureUtm setting as captureTracking.
ALTER TABLE "activity" ADD COLUMN "tracking" jsonb;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "click_ids" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "forms" SET "draft" = ("draft" - 'captureUtm') || jsonb_build_object('captureTracking', coalesce("draft"->'captureUtm', 'true'::jsonb)) WHERE "draft" ? 'captureUtm';--> statement-breakpoint
UPDATE "forms" SET "published" = ("published" - 'captureUtm') || jsonb_build_object('captureTracking', coalesce("published"->'captureUtm', 'true'::jsonb)) WHERE "published" ? 'captureUtm';--> statement-breakpoint
UPDATE "form_versions" SET "content" = ("content" - 'captureUtm') || jsonb_build_object('captureTracking', coalesce("content"->'captureUtm', 'true'::jsonb)) WHERE "content" ? 'captureUtm';
