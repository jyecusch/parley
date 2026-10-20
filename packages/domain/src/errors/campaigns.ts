import { DisplayName, type DomainError, EchoedInput, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { CampaignId, SegmentId, SendingDomainId, TemplateId, TopicId, UserId } from "../ids.ts"

/** No topic with that id in this team. */
export class TopicNotFound
  extends Schema.TaggedError<TopicNotFound>()("TopicNotFound", { team: DisplayName.schema, topicId: TopicId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `topic ${this.topicId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that topic in ${this.team}. It may have been deleted.`
  }
}

/** No segment with that id in this team. */
export class SegmentNotFound
  extends Schema.TaggedError<SegmentNotFound>()("SegmentNotFound", { team: DisplayName.schema, segmentId: SegmentId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `segment ${this.segmentId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that segment in ${this.team}. It may have been deleted.`
  }
}

/** Contacts are added to a fixed segment by hand; a dynamic one follows its filter. */
export class SegmentIsDynamic
  extends Schema.TaggedError<SegmentIsDynamic>()("SegmentIsDynamic", { segment: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "contacts can only be added to or removed from a fixed segment"
  }
  get userMessage() {
    return userText`${this.segment} is a dynamic segment, so its contacts come from its filter. Change the filter, or use a fixed segment to pick contacts by hand.`
  }
}

/** No template with that id in this team. */
export class TemplateNotFound
  extends Schema.TaggedError<TemplateNotFound>()("TemplateNotFound", {
    team: DisplayName.schema,
    templateId: TemplateId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `template ${this.templateId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that template in ${this.team}. It may have been deleted.`
  }
}

/** No campaign with that id in this team. */
export class CampaignNotFound
  extends Schema.TaggedError<CampaignNotFound>()("CampaignNotFound", {
    team: DisplayName.schema,
    campaignId: CampaignId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `campaign ${this.campaignId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that campaign in ${this.team}. It may have been deleted.`
  }
}

/** Only a draft can be edited, sent or deleted; a campaign that has gone out stays as sent (R42). */
export class CampaignNotDraft
  extends Schema.TaggedError<CampaignNotDraft>()("CampaignNotDraft", {
    campaign: DisplayName.schema,
    status: Schema.Literals(["sending", "sent", "cancelled"]),
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `campaign is ${this.status}, not a draft`
  }
  get userMessage() {
    return this.status === "sending"
      ? userText`${this.campaign} is being sent, so it can't be changed. You can cancel the rest of the sending.`
      : this.status === "sent"
        ? userText`${this.campaign} has been sent, so it can't be changed. Duplicate it to send something similar.`
        : userText`${this.campaign} was cancelled, so it can't be changed. Duplicate it to try again.`
  }
}

/** Only a campaign that's sending can be cancelled. */
export class CampaignNotSending
  extends Schema.TaggedError<CampaignNotSending>()("CampaignNotSending", { campaign: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "campaign is not sending"
  }
  get userMessage() {
    return userText`${this.campaign} isn't being sent, so there's nothing to cancel.`
  }
}

/** A campaign needs these before it can be sent. */
export class CampaignIncomplete
  extends Schema.TaggedError<CampaignIncomplete>()("CampaignIncomplete", {
    campaign: DisplayName.schema,
    missing: Schema.Array(Schema.Literals(["subject", "body", "segment"])),
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `campaign is missing ${this.missing.join(", ")}`
  }
  get userMessage() {
    const subject = this.missing.includes("subject")
    const body = this.missing.includes("body")
    const segment = this.missing.includes("segment")
    if (subject && body) return userText`${this.campaign} needs a subject and a body before it can be sent.`
    if (subject) return userText`${this.campaign} needs a subject before it can be sent.`
    if (body) return userText`${this.campaign} needs a body before it can be sent.`
    if (segment) return userText`${this.campaign} needs a segment to send to before it can be sent.`
    return userText`${this.campaign} isn't ready to send.`
  }
}

/** The segment has nobody a campaign would go to. */
export class SegmentHasNoRecipients
  extends Schema.TaggedError<SegmentHasNoRecipients>()("SegmentHasNoRecipients", { segment: DisplayName.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "segment has no subscribed contacts with an email"
  }
  get userMessage() {
    return userText`Nobody in ${this.segment} can be sent this campaign: a contact needs an email address and to be subscribed.`
  }
}

/** The team hasn't finished setting up its sender and footer (R40). */
export class SenderNotReady
  extends Schema.TaggedError<SenderNotReady>()("SenderNotReady", {
    team: DisplayName.schema,
    missing: Schema.Array(
      Schema.Literals([
        "sender-name",
        "sender-address",
        "verified-domain",
        "legal-name",
        "postal-address",
        "footer-reason",
      ]),
    ),
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `sender not ready: ${this.missing.join(", ")}`
  }
  get userMessage() {
    return this.missing.includes("verified-domain")
      ? userText`${this.team} can't send email until a sending domain is verified. An admin can add one in Settings → Email. Your draft is saved.`
      : userText`${this.team} can't send email until its sender and footer are set up. An admin can finish them in Settings → Email. Your draft is saved.`
  }
}

/** The sender address must be on one of the team's verified sending domains. */
export class SenderAddressNotOnSendingDomain
  extends Schema.TaggedError<SenderAddressNotOnSendingDomain>()("SenderAddressNotOnSendingDomain", {
    address: EchoedInput.schema,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "sender address is not on one of the team's sending domains"
  }
  get userMessage() {
    return userText`${this.address} isn't on one of your sending domains. Add its domain under Sending domains first.`
  }
}

/** No sending domain with that id in this team. */
export class SendingDomainNotFound
  extends Schema.TaggedError<SendingDomainNotFound>()("SendingDomainNotFound", {
    team: DisplayName.schema,
    sendingDomainId: SendingDomainId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `sending domain ${this.sendingDomainId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that sending domain in ${this.team}. It may have been removed.`
  }
}

/** A domain can be a sending domain for only one team. */
export class SendingDomainTaken
  extends Schema.TaggedError<SendingDomainTaken>()("SendingDomainTaken", { domain: EchoedInput.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "domain is already a sending domain"
  }
  get userMessage() {
    return userText`${this.domain} is already a sending domain, in this team or another. If it should be yours, remove it there first.`
  }
}

/** A test send goes to members of the team only (R45). */
export class TestRecipientNotMember
  extends Schema.TaggedError<TestRecipientNotMember>()("TestRecipientNotMember", {
    team: DisplayName.schema,
    userId: UserId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `test recipient ${this.userId} is not a member`
  }
  get userMessage() {
    return userText`Test sends go only to members of ${this.team}, and one of the people chosen isn't a member.`
  }
}

/** The unsubscribe link is damaged or not Parley's. */
export class UnsubscribeLinkInvalid
  extends Schema.TaggedError<UnsubscribeLinkInvalid>()("UnsubscribeLinkInvalid", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "unsubscribe token invalid"
  }
  get userMessage() {
    return userText`This unsubscribe link doesn't work. It may have been cut short when it was copied; try opening it from the email again, or reply to the email and ask to be removed.`
  }
}

/** A team can have only so many segments: each one is counted whenever segments are listed. */
export class SegmentLimitReached
  extends Schema.TaggedError<SegmentLimitReached>()("SegmentLimitReached", {
    team: DisplayName.schema,
    limit: Schema.Number,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `team has reached ${this.limit} segments`
  }
  get userMessage() {
    return userText`${this.team} has ${this.limit} segments, which is the most a team can have. Delete one you no longer use first.`
  }
}
