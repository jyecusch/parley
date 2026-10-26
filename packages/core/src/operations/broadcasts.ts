import {
  BroadcastIncomplete,
  type ContactId,
  type cancelBroadcast,
  type createBroadcast,
  type createTemplate,
  type DatabaseUnavailable,
  type deleteBroadcast,
  type deleteTemplate,
  type duplicateBroadcast,
  type EmailStyleId,
  type getBroadcast,
  type getTemplate,
  type listBroadcastRecipients,
  type listBroadcasts,
  type listTemplates,
  type OperationInput,
  type previewBroadcast,
  type previewTemplate,
  type SegmentId,
  type sendBroadcast,
  TestRecipientNotMember,
  type TopicId,
  type testSendBroadcast,
  type updateBroadcast,
  type updateTemplate,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Duration, Effect } from "effect"
import { type Footer, type MergeValues, mergeValuesOf, renderEmail, SAMPLE_VALUES } from "../email/render.ts"
import { Mailer } from "../mail/mailer.ts"
import type { Principal } from "../principal.ts"
import { proveBroadcastInTeam, proveBroadcastIsDraft } from "../proofs/broadcast-in-team.ts"
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
import { Broadcasts } from "../services/broadcasts.ts"
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
 * else the one saved on the template or broadcast, else the team's default (D117).
 */
const lookFor = <P, T>(member: MemberOf<P, T>, given: EmailStyleId | null | undefined, saved: EmailStyleId | null) =>
  Effect.gen(function* () {
    const styles = yield* EmailStyles
    const choice = yield* proveStyleChoice(member, given)
    return yield* styles.renderStyle(member.team.value, choice === undefined ? saved : (choice?.found.id ?? null))
  })

/** The team's footer for a preview, with placeholders for what isn't set up yet. */
export const previewFooter = <P, T>(
  member: MemberOf<P, T>,
  topicName: string | null = null,
): Effect.Effect<Footer, DatabaseUnavailable, Sending> =>
  Effect.gen(function* () {
    const sending = yield* Sending
    const settings = yield* sending.settings(member)
    return {
      legalName: settings.legalName ?? "Your legal name",
      postalAddress: settings.postalAddress ?? "Your postal address",
      topicName,
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

// Broadcasts

export const listAllBroadcasts = (principal: Principal, input: OperationInput<typeof listBroadcasts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* broadcasts.list(member, input.status)
    }),
  )

export const getOneBroadcast = (principal: Principal, input: OperationInput<typeof getBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return (yield* proveBroadcastInTeam(member, broadcast)).found
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

export const addBroadcast = (principal: Principal, input: OperationInput<typeof createBroadcast>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const links = yield* proveLinks(member, input.segmentId, input.topicId)
      const template = input.templateId === undefined ? undefined : yield* proveTemplateOfTeam(member, input.templateId)
      const style = yield* proveStyleChoice(member, input.styleId)
      return yield* broadcasts.create(access, { ...input, ...links, template, style })
    }),
  )

export const changeBroadcast = (principal: Principal, input: OperationInput<typeof updateBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveBroadcastInTeam(member, broadcast)
      const draft = yield* proveBroadcastIsDraft(target)
      const links = yield* proveLinks(member, input.segmentId, input.topicId)
      const style = yield* proveStyleChoice(member, input.styleId)
      return yield* broadcasts.update(target, draft, { ...input, ...links, style }, access)
    }),
  )

export const removeBroadcast = (principal: Principal, input: OperationInput<typeof deleteBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveBroadcastInTeam(member, broadcast)
      const draft = yield* proveBroadcastIsDraft(target)
      return yield* broadcasts.delete(target, draft, access)
    }),
  )

export const copyBroadcast = (principal: Principal, input: OperationInput<typeof duplicateBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanWriteEmail(member)
      const target = yield* proveBroadcastInTeam(member, broadcast)
      return yield* broadcasts.duplicate(target, access)
    }),
  )

export const previewOneBroadcast = (principal: Principal, input: OperationInput<typeof previewBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveBroadcastInTeam(member, broadcast)
      const found = target.found
      const values = yield* valuesFor(member, canRead, input.contactId)
      const footer = yield* previewFooter(member, found.topicName)
      // A sent broadcast shows the look it was sent with, unless another is asked for.
      const look =
        found.status !== "draft" && input.styleId === undefined
          ? yield* (yield* Broadcasts).sentStyle(target)
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

export const testSend = (principal: Principal, input: OperationInput<typeof testSendBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const members = yield* Members
      const sending = yield* Sending
      const mailer = yield* Mailer
      const links = yield* UnsubscribeLinks
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      yield* proveCanWriteEmail(member)
      const found = (yield* proveBroadcastInTeam(member, broadcast)).found
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
        broadcastId: found.id,
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
          topicName: found.topicName,
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

export const send = (principal: Principal, input: OperationInput<typeof sendBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const segments = yield* Segments
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanSendEmail(member)
      const target = yield* proveBroadcastInTeam(member, broadcast)
      const draft = yield* proveBroadcastIsDraft(target)
      const found = target.found
      const missing = [
        ...(found.subject.trim() ? [] : (["subject"] as const)),
        ...(found.body.trim() ? [] : (["body"] as const)),
        ...(found.segmentId ? [] : (["segment"] as const)),
      ]
      if (missing.length > 0 || !found.segmentId) {
        return yield* new BroadcastIncomplete({ broadcast: DisplayName.fromRecord(found.name), missing })
      }
      const sender = yield* sending.sender(member)
      // The look is copied with the sender, so editing the style later doesn't change what went out.
      const style = yield* (yield* EmailStyles).renderStyle(team.value, found.styleId)
      return yield* named(found.segmentId, (segmentId) =>
        Effect.gen(function* () {
          const segment = yield* proveSegmentInTeam(member, segmentId)
          const scope = yield* segments.scope(segment)
          return yield* broadcasts.queue(target, draft, segment, scope, { ...sender, style }, access)
        }),
      )
    }),
  )

export const cancel = (principal: Principal, input: OperationInput<typeof cancelBroadcast>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const access = yield* proveCanSendEmail(member)
      const target = yield* proveBroadcastInTeam(member, broadcast)
      return yield* broadcasts.cancel(target, access)
    }),
  )

export const recipients = (principal: Principal, input: OperationInput<typeof listBroadcastRecipients>) =>
  named(principal, input.teamId, input.broadcastId, (principal, team, broadcast) =>
    Effect.gen(function* () {
      const broadcasts = yield* Broadcasts
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const target = yield* proveBroadcastInTeam(member, broadcast)
      return yield* broadcasts.recipients(target, input)
    }),
  )
