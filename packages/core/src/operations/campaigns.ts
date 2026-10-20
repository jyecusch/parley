import {
  CampaignIncomplete,
  type ContactId,
  type cancelCampaign,
  type createCampaign,
  type createTemplate,
  type DatabaseUnavailable,
  type deleteCampaign,
  type deleteTemplate,
  type duplicateCampaign,
  type EmailStyleId,
  type getCampaign,
  type getTemplate,
  type listCampaignRecipients,
  type listCampaigns,
  type listTemplates,
  type OperationInput,
  type previewCampaign,
  type previewTemplate,
  type SegmentId,
  type sendCampaign,
  TestRecipientNotMember,
  type TopicId,
  type testSendCampaign,
  type updateCampaign,
  type updateTemplate,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Duration, Effect } from "effect"
import { type Footer, type MergeValues, mergeValuesOf, renderEmail, SAMPLE_VALUES } from "../email/render.ts"
import { Mailer } from "../mail/mailer.ts"
import type { Principal } from "../principal.ts"
import { proveCampaignInTeam, proveCampaignIsDraft } from "../proofs/campaign-in-team.ts"
import { proveContactInTeam } from "../proofs/contact-in-team.ts"
import { proveStyleChoice } from "../proofs/email-style-in-team.ts"
import { type MemberOf, proveMemberOf } from "../proofs/member-of.ts"
import {
  type CanReadRecords,
  proveCanReadRecords,
  proveCanSendEmail,
  proveCanWriteEmail,
} from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { proveSegmentInTeam, proveSegmentOfTeam } from "../proofs/segment-in-team.ts"
import { proveTemplateInTeam, proveTemplateOfTeam } from "../proofs/template-in-team.ts"
import { proveTopicsInTeam } from "../proofs/topic-in-team.ts"
import { Campaigns } from "../services/campaigns.ts"
import { Contacts } from "../services/contacts.ts"
import { EmailStyles } from "../services/email-styles.ts"
import { Members } from "../services/members.ts"
import { RateLimiter } from "../services/rate-limiter.ts"
import { Segments } from "../services/segments.ts"
import { Sending } from "../services/sending.ts"
import { Templates } from "../services/templates.ts"
import { UnsubscribeLinks } from "../services/unsubscribe-links.ts"

// Templates

export const listAllTemplates = (principal: Principal, input: OperationInput<typeof listTemplates>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const templates = yield* Templates
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* templates.list(member)
    }),
  )

export const getOneTemplate = (principal: Principal, input: OperationInput<typeof getTemplate>) =>
  named(principal, input.teamId, input.templateId, (principal, team, template) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return (yield* proveTemplateInTeam(member, template)).found
    }),
  )

export const addTemplate = (principal: Principal, input: OperationInput<typeof createTemplate>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const templates = yield* Templates
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const style = yield* proveStyleChoice(member, input.styleId)
      return yield* templates.create(access, { ...input, style })
    }),
  )

export const changeTemplate = (principal: Principal, input: OperationInput<typeof updateTemplate>) =>
  named(principal, input.teamId, input.templateId, (principal, team, template) =>
    Effect.gen(function* () {
      const templates = yield* Templates
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveTemplateInTeam(member, template)
      const style = yield* proveStyleChoice(member, input.styleId)
      return yield* templates.update(target, { ...input, style }, access)
    }),
  )

export const removeTemplate = (principal: Principal, input: OperationInput<typeof deleteTemplate>) =>
  named(principal, input.teamId, input.templateId, (principal, team, template) =>
    Effect.gen(function* () {
      const templates = yield* Templates
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveTemplateInTeam(member, template)
      return yield* templates.delete(target, access)
    }),
  )

/** Merge tag values from a contact the principal can read, or sample ones. */
const valuesFor = <P, T>(member: MemberOf<P, T>, canRead: CanReadRecords<P, T>, contactId: ContactId | undefined) =>
  contactId === undefined
    ? Effect.succeed(SAMPLE_VALUES)
    : named(contactId, (contact) =>
        Effect.gen(function* () {
          const contacts = yield* Contacts
          const target = yield* proveContactInTeam(member.team, contact, canRead)
          const found = yield* contacts.get(target)
          const values: MergeValues = mergeValuesOf({
            firstName: found.firstName,
            lastName: found.lastName,
            email: (found.emails.find((email) => email.isPrimary) ?? found.emails[0])?.address ?? null,
            company: found.affiliations[0]?.companyName ?? null,
          })
          return values
        }),
      )

/**
 * The look to render with: the style given for an unsaved choice (null is the team's default),
 * else the one saved on the template or campaign, else the team's default (D117).
 */
const lookFor = <P, T>(member: MemberOf<P, T>, given: EmailStyleId | null | undefined, saved: EmailStyleId | null) =>
  Effect.gen(function* () {
    const styles = yield* EmailStyles
    const choice = yield* proveStyleChoice(member, given)
    return yield* styles.renderStyle(member.team.value, choice === undefined ? saved : (choice?.found.id ?? null))
  })

/** The team's footer for a preview, with placeholders for what isn't set up yet. */
export const previewFooter = <P, T>(member: MemberOf<P, T>): Effect.Effect<Footer, DatabaseUnavailable, Sending> =>
  Effect.gen(function* () {
    const sending = yield* Sending
    const settings = yield* sending.settings(member)
    return {
      legalName: settings.legalName ?? "Your legal name",
      postalAddress: settings.postalAddress ?? "Your postal address",
      reason: settings.footerReason ?? "Why recipients get your email.",
      unsubscribeUrl: null,
    }
  })

export const previewOneTemplate = (principal: Principal, input: OperationInput<typeof previewTemplate>) =>
  named(principal, input.teamId, input.templateId, (principal, team, template) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const found = (yield* proveTemplateInTeam(member, template)).found
      const values = yield* valuesFor(member, canRead, input.contactId)
      const footer = yield* previewFooter(member)
      const look = yield* lookFor(member, input.styleId, found.styleId)
      return renderEmail(
        {
          subject: input.subject ?? found.subject,
          previewText: input.previewText ?? found.previewText,
          body: input.body ?? found.body,
        },
        values,
        footer,
        look,
      )
    }),
  )

// Campaigns

export const listAllCampaigns = (principal: Principal, input: OperationInput<typeof listCampaigns>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* campaigns.list(member, input.status)
    }),
  )

export const getOneCampaign = (principal: Principal, input: OperationInput<typeof getCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return (yield* proveCampaignInTeam(member, campaign)).found
    }),
  )

/** Proves a segment and topic for a draft: undefined leaves them, null clears them. */
const proveLinks = <P, T>(
  member: MemberOf<P, T>,
  segmentId: SegmentId | null | undefined,
  topicId: TopicId | null | undefined,
) =>
  Effect.all({
    segment: segmentId == null ? Effect.succeed(segmentId) : proveSegmentOfTeam(member, segmentId),
    topic: topicId == null ? Effect.succeed(topicId) : proveTopicsInTeam(member, [topicId]),
  })

export const addCampaign = (principal: Principal, input: OperationInput<typeof createCampaign>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const links = yield* proveLinks(member, input.segmentId, input.topicId)
      const template = input.templateId === undefined ? undefined : yield* proveTemplateOfTeam(member, input.templateId)
      const style = yield* proveStyleChoice(member, input.styleId)
      return yield* campaigns.create(access, { ...input, ...links, template, style })
    }),
  )

export const changeCampaign = (principal: Principal, input: OperationInput<typeof updateCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveCampaignInTeam(member, campaign)
      const draft = yield* proveCampaignIsDraft(target)
      const links = yield* proveLinks(member, input.segmentId, input.topicId)
      const style = yield* proveStyleChoice(member, input.styleId)
      return yield* campaigns.update(target, draft, { ...input, ...links, style }, access)
    }),
  )

export const removeCampaign = (principal: Principal, input: OperationInput<typeof deleteCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveCampaignInTeam(member, campaign)
      const draft = yield* proveCampaignIsDraft(target)
      return yield* campaigns.delete(target, draft, access)
    }),
  )

export const copyCampaign = (principal: Principal, input: OperationInput<typeof duplicateCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveCampaignInTeam(member, campaign)
      return yield* campaigns.duplicate(target, access)
    }),
  )

export const previewOneCampaign = (principal: Principal, input: OperationInput<typeof previewCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveCampaignInTeam(member, campaign)
      const found = target.found
      const values = yield* valuesFor(member, canRead, input.contactId)
      const footer = yield* previewFooter(member)
      // A sent campaign shows the look it was sent with, unless another is asked for.
      const look =
        found.status !== "draft" && input.styleId === undefined
          ? yield* (yield* Campaigns).sentStyle(target)
          : yield* lookFor(member, input.styleId, found.styleId)
      return renderEmail(
        {
          subject: input.subject ?? found.subject,
          previewText: input.previewText ?? found.previewText,
          body: input.body ?? found.body,
        },
        values,
        footer,
        look,
      )
    }),
  )

export const testSend = (principal: Principal, input: OperationInput<typeof testSendCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const members = yield* Members
      const sending = yield* Sending
      const mailer = yield* Mailer
      const links = yield* UnsubscribeLinks
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      yield* proveCanWriteEmail(member)
      const found = (yield* proveCampaignInTeam(member, campaign)).found
      // Test sends go out on the shared sending reputation, so each team gets a modest allowance.
      yield* (yield* RateLimiter).take(`test-send:${team.value}`, 30, Duration.hours(1))
      // Test sends go to members only (R45), defaulting to whoever asked.
      const people = yield* members.people(member)
      const wanted = input.userIds ?? [principal.value.userId]
      const to: Array<string> = []
      for (const userId of wanted) {
        const person = people.find((candidate) => candidate.userId === userId)
        if (!person) return yield* new TestRecipientNotMember({ team: member.teamName, userId })
        to.push(person.email)
      }
      const sender = yield* sending.sender(member)
      const values = yield* valuesFor(member, canRead, input.contactId)
      const token = links.sign({
        teamId: team.value,
        contactId: null,
        topicId: found.topicId,
        campaignId: found.id,
        test: true,
      })
      const urls = links.urls(token)
      const look = yield* (yield* EmailStyles).renderStyle(team.value, found.styleId)
      const rendered = renderEmail(
        found,
        values,
        {
          legalName: sender.legalName,
          postalAddress: sender.postalAddress,
          reason: sender.footerReason,
          unsubscribeUrl: urls.page,
        },
        look,
      )
      yield* mailer.sendBatch(
        to.map((address) => ({
          to: address,
          from: sender.from,
          ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
          subject: `[Test] ${rendered.subject}`,
          html: rendered.html,
          text: rendered.text,
          headers: { "List-Unsubscribe": `<${urls.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        })),
      )
      return { sentTo: to }
    }),
  )

export const send = (principal: Principal, input: OperationInput<typeof sendCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const segments = yield* Segments
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanSendEmail(member)
      const target = yield* proveCampaignInTeam(member, campaign)
      const draft = yield* proveCampaignIsDraft(target)
      const found = target.found
      const missing = [
        ...(found.subject.trim() ? [] : (["subject"] as const)),
        ...(found.body.trim() ? [] : (["body"] as const)),
        ...(found.segmentId ? [] : (["segment"] as const)),
      ]
      if (missing.length > 0 || !found.segmentId) {
        return yield* new CampaignIncomplete({ campaign: DisplayName.fromRecord(found.name), missing })
      }
      const sender = yield* sending.sender(member)
      // The look is copied with the sender, so editing the style later doesn't change what went out.
      const style = yield* (yield* EmailStyles).renderStyle(team.value, found.styleId)
      return yield* named(found.segmentId, (segmentId) =>
        Effect.gen(function* () {
          const segment = yield* proveSegmentInTeam(member, segmentId)
          const scope = yield* segments.scope(segment)
          return yield* campaigns.queue(target, draft, segment, scope, { ...sender, style }, access)
        }),
      )
    }),
  )

export const cancel = (principal: Principal, input: OperationInput<typeof cancelCampaign>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanSendEmail(member)
      const target = yield* proveCampaignInTeam(member, campaign)
      return yield* campaigns.cancel(target, access)
    }),
  )

export const recipients = (principal: Principal, input: OperationInput<typeof listCampaignRecipients>) =>
  named(principal, input.teamId, input.campaignId, (principal, team, campaign) =>
    Effect.gen(function* () {
      const campaigns = yield* Campaigns
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const target = yield* proveCampaignInTeam(member, campaign)
      return yield* campaigns.recipients(target, input)
    }),
  )
