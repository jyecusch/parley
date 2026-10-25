-- "Floating" labels were never built, so forms that chose them showed labels above (review fix).
UPDATE "forms" SET "draft" = jsonb_set("draft", '{appearance,labels}', '"above"') WHERE "draft" #>> '{appearance,labels}' = 'floating';--> statement-breakpoint
UPDATE "forms" SET "published" = jsonb_set("published", '{appearance,labels}', '"above"') WHERE "published" #>> '{appearance,labels}' = 'floating';--> statement-breakpoint
UPDATE "form_versions" SET "content" = jsonb_set("content", '{appearance,labels}', '"above"') WHERE "content" #>> '{appearance,labels}' = 'floating';
