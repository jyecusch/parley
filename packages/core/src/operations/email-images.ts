import type { EmailImage, importEmailImage, OperationInput, uploadEmailImage } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanWriteEmail } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { EmailImages, type HostedEmailImage } from "../services/email-images.ts"

const toEmailImage = (image: HostedEmailImage): EmailImage => ({
  id: image.id,
  url: image.url,
  width: image.width,
  height: image.height,
  createdAt: image.createdAt,
})

/** emailImages.upload: host an uploaded image for use in emails (D120). */
export const upload = (principal: Principal, input: OperationInput<typeof uploadEmailImage>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const images = yield* EmailImages
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanWriteEmail(member)
      return toEmailImage(yield* images.fromUpload(member.team.value, input.image))
    }),
  )

/** emailImages.import: copy an image from a public address so an email doesn't depend on it (D120). */
export const importFromUrl = (principal: Principal, input: OperationInput<typeof importEmailImage>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const images = yield* EmailImages
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanWriteEmail(member)
      return toEmailImage(yield* images.fromUrl(member.team.value, input.url))
    }),
  )
