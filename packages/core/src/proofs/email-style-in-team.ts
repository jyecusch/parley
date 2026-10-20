import {
  type DatabaseUnavailable,
  type EmailStyle,
  type EmailStyleId,
  EmailStyleNotFound,
  type TeamId,
} from "@parley/domain"
import { Effect } from "effect"
import { EmailStyles } from "../services/email-styles.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const EmailStyleInTeamProver = defineProof("EmailStyleInTeam")

/** Email style S belongs to team T. */
export interface EmailStyleInTeam<S, T> extends Proof<"EmailStyleInTeam", [S, T]> {
  readonly team: Named<T, TeamId>
  readonly style: Named<S, EmailStyleId>
  readonly found: EmailStyle
}

export const proveEmailStyleInTeam = <P, T, S>(
  member: MemberOf<P, T>,
  style: Named<S, EmailStyleId>,
): Effect.Effect<EmailStyleInTeam<S, T>, EmailStyleNotFound | DatabaseUnavailable, EmailStyles> =>
  Effect.gen(function* () {
    const styles = yield* EmailStyles
    const found = yield* styles.locate(member.team.value, style.value)
    if (!found) return yield* new EmailStyleNotFound({ team: member.teamName, styleId: style.value })
    return { ...EmailStyleInTeamProver.prove(style, member.team), team: member.team, style, found }
  })

const EmailStyleOfTeamProver = defineProof("EmailStyleOfTeam")

/** An email style belongs to team T. For a template or campaign choosing it, where its id needn't be named. */
export interface EmailStyleOfTeam<T> extends Proof<"EmailStyleOfTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly found: EmailStyle
}

export const proveEmailStyleOfTeam = <P, T>(
  member: MemberOf<P, T>,
  styleId: EmailStyleId,
): Effect.Effect<EmailStyleOfTeam<T>, EmailStyleNotFound | DatabaseUnavailable, EmailStyles> =>
  Effect.gen(function* () {
    const styles = yield* EmailStyles
    const found = yield* styles.locate(member.team.value, styleId)
    if (!found) return yield* new EmailStyleNotFound({ team: member.teamName, styleId })
    return { ...EmailStyleOfTeamProver.prove(member.team), team: member.team, found }
  })

/**
 * A template's or campaign's choice of style: undefined leaves it, null means the team's default,
 * and an id must be a style in the team.
 */
export const proveStyleChoice = <P, T>(member: MemberOf<P, T>, styleId: EmailStyleId | null | undefined) =>
  styleId == null ? Effect.succeed(styleId) : proveEmailStyleOfTeam(member, styleId)
