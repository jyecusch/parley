-- D151: American spelling. Statuses say "canceled", not "cancelled".
UPDATE "broadcasts" SET "status" = 'canceled' WHERE "status" = 'cancelled';--> statement-breakpoint
UPDATE "broadcast_recipients" SET "status" = 'canceled' WHERE "status" = 'cancelled';--> statement-breakpoint
UPDATE "imports" SET "status" = 'canceled' WHERE "status" = 'cancelled';
