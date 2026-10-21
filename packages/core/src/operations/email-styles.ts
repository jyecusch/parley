import type {
  createEmailStyle,
  deleteEmailStyle,
  getEmailStyle,
  listEmailStyles,
  OperationInput,
  previewEmailStyle,
  setDefaultEmailStyle,
  updateEmailStyle,
} from "@parley/domain"
import { Effect } from "effect"
import { PLAIN_STYLE, type RenderStyle, renderEmail, SAMPLE_VALUES } from "../email/render.ts"
import type { Principal } from "../principal.ts"
import { proveEmailStyleInTeam } from "../proofs/email-style-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanManageEmail, proveCanWriteEmail } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { checkCustomHtml, EmailStyles } from "../services/email-styles.ts"
import { previewFooter } from "./broadcasts.ts"

/** What a style's preview shows: the parts of an email a style changes. */
const SAMPLE_CONTENT = {
  subject: "A preview of this email style",
  previewText: "How your emails look in this style.",
  body: [
    "# A heading in your email",
    "",
    "Hi {{first_name|there}}, this is how body text looks in this style, with [a link](https://example.com) in it.",
    "",
    "[[button: A button | https://example.com]]",
    "",
    "Thanks,  ",
    "The team",
  ].join("\n"),
}

export const list = (principal: Principal, input: OperationInput<typeof listEmailStyles>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const styles = yield* EmailStyles
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanWriteEmail(member)
      return yield* styles.list(member)
    }),
  )

export const get = (principal: Principal, input: OperationInput<typeof getEmailStyle>) =>
  named(principal, input.teamId, input.styleId, (principal, team, style) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanWriteEmail(member)
      return (yield* proveEmailStyleInTeam(member, style)).found
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createEmailStyle>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const styles = yield* EmailStyles
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      return yield* styles.create(access, input)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateEmailStyle>) =>
  named(principal, input.teamId, input.styleId, (principal, team, style) =>
    Effect.gen(function* () {
      const styles = yield* EmailStyles
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveEmailStyleInTeam(member, style)
      return yield* styles.update(target, input, access)
    }),
  )

export const setDefault = (principal: Principal, input: OperationInput<typeof setDefaultEmailStyle>) =>
  named(principal, input.teamId, input.styleId, (principal, team, style) =>
    Effect.gen(function* () {
      const styles = yield* EmailStyles
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveEmailStyleInTeam(member, style)
      return yield* styles.setDefault(target, access)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteEmailStyle>) =>
  named(principal, input.teamId, input.styleId, (principal, team, style) =>
    Effect.gen(function* () {
      const styles = yield* EmailStyles
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveEmailStyleInTeam(member, style)
      return yield* styles.delete(target, access)
    }),
  )

export const preview = (principal: Principal, input: OperationInput<typeof previewEmailStyle>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanWriteEmail(member)
      // A saved style, or the plain look for one not saved yet, with any unsaved changes on top.
      const base: RenderStyle =
        input.styleId === undefined
          ? PLAIN_STYLE
          : yield* named(input.styleId, (style) =>
              Effect.map(proveEmailStyleInTeam(member, style), (target) => target.found),
            )
      const look: RenderStyle = {
        layout: input.layout ?? base.layout,
        logoUrl: input.logoUrl === undefined ? base.logoUrl : input.logoUrl,
        logoAlign: input.logoAlign ?? base.logoAlign,
        headerText: input.headerText === undefined ? base.headerText : input.headerText,
        footerAlign: input.footerAlign ?? base.footerAlign,
        colors: input.colors ?? base.colors,
        font: input.font ?? base.font,
        customHtml: input.customHtml === undefined ? base.customHtml : input.customHtml,
      }
      yield* checkCustomHtml(look.layout, look.customHtml)
      const footer = yield* previewFooter(member)
      return renderEmail(SAMPLE_CONTENT, SAMPLE_VALUES, footer, look)
    }),
  )
