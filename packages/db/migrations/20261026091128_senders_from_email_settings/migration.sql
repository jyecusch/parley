-- Each team's sender becomes its default sender (D162). A sender needs every part, so a team that
-- hadn't finished setting one up adds it again.
INSERT INTO "senders" ("id", "team_id", "name", "address", "reply_to", "legal_name", "postal_address", "is_default")
SELECT gen_random_uuid(), "team_id", "sender_name", "sender_address", "reply_to", "legal_name", "postal_address", true
FROM "email_settings"
WHERE "sender_name" IS NOT NULL AND "sender_address" IS NOT NULL AND "legal_name" IS NOT NULL AND "postal_address" IS NOT NULL;--> statement-breakpoint
-- Forms pick who their confirmation email is from; null is the default sender.
UPDATE "forms" SET "draft" = "draft" || '{"senderId": null}'::jsonb, "published" = CASE WHEN "published" IS NULL THEN NULL ELSE "published" || '{"senderId": null}'::jsonb END;--> statement-breakpoint
UPDATE "form_versions" SET "content" = "content" || '{"senderId": null}'::jsonb;--> statement-breakpoint
DROP TABLE "email_settings" CASCADE;
