import { type DatabaseUnavailable, type TeamId, type Template, type TemplateId, TemplateNotFound } from "@parley/domain"
import { Effect } from "effect"
import { Templates } from "../services/templates.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const TemplateInTeamProver = defineProof("TemplateInTeam")

/** Template K belongs to team T. */
export interface TemplateInTeam<K, T> extends Proof<"TemplateInTeam", [K, T]> {
  readonly team: Named<T, TeamId>
  readonly template: Named<K, TemplateId>
  readonly found: Template
}

export const proveTemplateInTeam = <P, T, K>(
  member: MemberOf<P, T>,
  template: Named<K, TemplateId>,
): Effect.Effect<TemplateInTeam<K, T>, TemplateNotFound | DatabaseUnavailable, Templates> =>
  Effect.gen(function* () {
    const templates = yield* Templates
    const found = yield* templates.locate(member.team.value, template.value)
    if (!found) return yield* new TemplateNotFound({ team: member.teamName, templateId: template.value })
    return { ...TemplateInTeamProver.prove(template, member.team), team: member.team, template, found }
  })

const TemplateOfTeamProver = defineProof("TemplateOfTeam")

/** A template belongs to team T. For starting a broadcast from it, where its id needn't be named. */
export interface TemplateOfTeam<T> extends Proof<"TemplateOfTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly found: Template
}

export const proveTemplateOfTeam = <P, T>(
  member: MemberOf<P, T>,
  templateId: TemplateId,
): Effect.Effect<TemplateOfTeam<T>, TemplateNotFound | DatabaseUnavailable, Templates> =>
  Effect.gen(function* () {
    const templates = yield* Templates
    const found = yield* templates.locate(member.team.value, templateId)
    if (!found) return yield* new TemplateNotFound({ team: member.teamName, templateId })
    return { ...TemplateOfTeamProver.prove(member.team), team: member.team, found }
  })
