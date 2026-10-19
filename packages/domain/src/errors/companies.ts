import { DisplayName, type DomainError, EchoedInput, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { AffiliationId, CompanyId } from "../ids.ts"

/**
 * No company with that id in this team that isn't deleted. Also returned when the id belongs to
 * another team (D37) and when restoring a company that has been purged.
 */
export class CompanyNotFound
  extends Schema.TaggedError<CompanyNotFound>()("CompanyNotFound", { team: DisplayName.schema, companyId: CompanyId })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `company ${this.companyId} not found in team`
  }
  get userMessage() {
    return userText`We can't find this company in ${this.team}. It may have been deleted. Search companies to find the one you're looking for.`
  }
}

/** Another company in the team already has this domain (D25). Also possible on restore. */
export class CompanyDomainTaken
  extends Schema.TaggedError<CompanyDomainTaken>()("CompanyDomainTaken", {
    team: DisplayName.schema,
    domain: EchoedInput.schema,
    existing: CompanyId,
    existingName: DisplayName.schema,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `domain already used by company ${this.existing}`
  }
  get userMessage() {
    return userText`${this.domain} already belongs to ${this.existingName} in ${this.team}. A domain can belong to one company. Remove it from ${this.existingName} first, or use a different domain.`
  }
}

/** A free email domain such as gmail.com can't be a company's domain (D106). */
export class FreeEmailDomain
  extends Schema.TaggedError<FreeEmailDomain>()("FreeEmailDomain", { domain: EchoedInput.schema })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "free email domain given as a company domain"
  }
  get userMessage() {
    return userText`${this.domain} is a free email domain that anyone can use, so it can't belong to a company. Use the company's own domain, like the one in its staff's email addresses.`
  }
}

/** No affiliation with that id in this team, or its contact or company is deleted. */
export class AffiliationNotFound
  extends Schema.TaggedError<AffiliationNotFound>()("AffiliationNotFound", {
    team: DisplayName.schema,
    affiliationId: AffiliationId,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `affiliation ${this.affiliationId} not found in team`
  }
  get userMessage() {
    return userText`We can't find that link between a contact and a company in ${this.team}. It may have been removed already.`
  }
}
