import type {
  ImageTooLarge,
  ImageUnreadable,
  OperationInput,
  removeCompanyLogo,
  removeContactAvatar,
  setCompanyLogo,
  setContactAvatar,
} from "@parley/domain"
import { Effect } from "effect"
import { bytesOf, normalizeImage } from "../files/images.ts"
import type { Principal } from "../principal.ts"
import { proveCompanyInTeam } from "../proofs/company-in-team.ts"
import { proveContactInTeam } from "../proofs/contact-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Companies } from "../services/companies.ts"
import { Contacts } from "../services/contacts.ts"

/** The stored image, or null to remove it. Only run once access is proven. */
type ImageOf<E> = Effect.Effect<Uint8Array | null, E>
const decode = (image: string): ImageOf<ImageUnreadable | ImageTooLarge> => normalizeImage(bytesOf(image))
const none: ImageOf<never> = Effect.succeed(null)

/** Sets or removes a contact's avatar. */
const avatar = <E>(
  principal: Principal,
  input: { readonly teamId: string; readonly contactId: string },
  image: ImageOf<E>,
) =>
  named(principal, input.teamId as never, input.contactId as never, (principal, team, contact) =>
    Effect.gen(function* () {
      const contacts = yield* Contacts
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveContactInTeam(team, contact, canRead)
      const bytes = yield* image
      return yield* contacts.setAvatar(target, bytes, canWrite)
    }),
  )

const logo = <E>(
  principal: Principal,
  input: { readonly teamId: string; readonly companyId: string },
  image: ImageOf<E>,
) =>
  named(principal, input.teamId as never, input.companyId as never, (principal, team, company) =>
    Effect.gen(function* () {
      const companies = yield* Companies
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveCompanyInTeam(team, company, canRead)
      const bytes = yield* image
      return yield* companies.setLogo(target, bytes, canWrite)
    }),
  )

export const setAvatar = (principal: Principal, input: OperationInput<typeof setContactAvatar>) =>
  avatar(principal, input, decode(input.image))
export const removeAvatar = (principal: Principal, input: OperationInput<typeof removeContactAvatar>) =>
  avatar(principal, input, none)
export const setLogo = (principal: Principal, input: OperationInput<typeof setCompanyLogo>) =>
  logo(principal, input, decode(input.image))
export const removeLogo = (principal: Principal, input: OperationInput<typeof removeCompanyLogo>) =>
  logo(principal, input, none)
