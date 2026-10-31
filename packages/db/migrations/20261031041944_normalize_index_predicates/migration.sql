DROP INDEX "email_styles_default_key";--> statement-breakpoint
CREATE UNIQUE INDEX "email_styles_default_key" ON "email_styles" ("team_id") WHERE "is_default";--> statement-breakpoint
DROP INDEX "senders_default_key";--> statement-breakpoint
CREATE UNIQUE INDEX "senders_default_key" ON "senders" ("team_id") WHERE "is_default";--> statement-breakpoint
DROP INDEX "broadcasts_sending_idx";--> statement-breakpoint
CREATE INDEX "broadcasts_sending_idx" ON "broadcasts" ("team_id") WHERE "status" = 'sending';