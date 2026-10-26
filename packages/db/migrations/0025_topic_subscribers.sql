-- People who joined an opt-in topic are its subscribers: "member" is a team's (terminology, 2026-10-26).
ALTER TABLE "topic_members" RENAME TO "topic_subscribers";--> statement-breakpoint
ALTER TABLE "topic_subscribers" RENAME CONSTRAINT "topic_members_key" TO "topic_subscribers_key";--> statement-breakpoint
ALTER TABLE "topic_subscribers" RENAME CONSTRAINT "topic_members_contact_id_contacts_id_fk" TO "topic_subscribers_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "topic_subscribers" RENAME CONSTRAINT "topic_members_team_id_organization_id_fk" TO "topic_subscribers_team_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "topic_subscribers" RENAME CONSTRAINT "topic_members_topic_id_topics_id_fk" TO "topic_subscribers_topic_id_topics_id_fk";--> statement-breakpoint
ALTER INDEX "topic_members_topic_idx" RENAME TO "topic_subscribers_topic_idx";
