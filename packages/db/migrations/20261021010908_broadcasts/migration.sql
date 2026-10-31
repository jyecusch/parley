-- D140: a campaign is now a broadcast. Renames only, so every row is kept.
ALTER TABLE "campaigns" RENAME TO "broadcasts";--> statement-breakpoint
ALTER TABLE "campaign_recipients" RENAME TO "broadcast_recipients";--> statement-breakpoint
ALTER TABLE "broadcast_recipients" RENAME COLUMN "campaign_id" TO "broadcast_id";--> statement-breakpoint
ALTER TABLE "broadcasts" RENAME CONSTRAINT "campaigns_pkey" TO "broadcasts_pkey";--> statement-breakpoint
ALTER TABLE "broadcasts" RENAME CONSTRAINT "campaigns_team_id_organization_id_fk" TO "broadcasts_team_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "broadcasts" RENAME CONSTRAINT "campaigns_segment_id_segments_id_fk" TO "broadcasts_segment_id_segments_id_fk";--> statement-breakpoint
ALTER TABLE "broadcasts" RENAME CONSTRAINT "campaigns_topic_id_topics_id_fk" TO "broadcasts_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "broadcasts" RENAME CONSTRAINT "campaigns_sent_by_user_id_user_id_fk" TO "broadcasts_sent_by_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "broadcasts" RENAME CONSTRAINT "campaigns_style_id_email_styles_id_fk" TO "broadcasts_style_id_email_styles_id_fk";--> statement-breakpoint
ALTER TABLE "broadcast_recipients" RENAME CONSTRAINT "campaign_recipients_pkey" TO "broadcast_recipients_pkey";--> statement-breakpoint
ALTER TABLE "broadcast_recipients" RENAME CONSTRAINT "campaign_recipients_key" TO "broadcast_recipients_key";--> statement-breakpoint
ALTER TABLE "broadcast_recipients" RENAME CONSTRAINT "campaign_recipients_team_id_organization_id_fk" TO "broadcast_recipients_team_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "broadcast_recipients" RENAME CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" TO "broadcast_recipients_broadcast_id_broadcasts_id_fk";--> statement-breakpoint
ALTER TABLE "broadcast_recipients" RENAME CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" TO "broadcast_recipients_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER INDEX "campaigns_team_idx" RENAME TO "broadcasts_team_idx";--> statement-breakpoint
ALTER INDEX "campaign_recipients_queue_idx" RENAME TO "broadcast_recipients_queue_idx";--> statement-breakpoint
ALTER INDEX "campaign_recipients_provider_idx" RENAME TO "broadcast_recipients_provider_idx";--> statement-breakpoint
UPDATE "activity" SET "related_record_type" = 'broadcast' WHERE "related_record_type" = 'campaign';
