import {
  type DatabaseUnavailable,
  type SendingDomain,
  type SendingDomainId,
  SendingDomainNotFound,
  type TeamId,
} from "@parley/domain"
import { Effect } from "effect"
import { Sending } from "../services/sending.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const SendingDomainInTeamProver = defineProof("SendingDomainInTeam")

/** Sending domain D belongs to team T. */
export interface SendingDomainInTeam<D, T> extends Proof<"SendingDomainInTeam", [D, T]> {
  readonly team: Named<T, TeamId>
  readonly domain: Named<D, SendingDomainId>
  readonly found: SendingDomain
}

export const proveSendingDomainInTeam = <P, T, D>(
  member: MemberOf<P, T>,
  domain: Named<D, SendingDomainId>,
): Effect.Effect<SendingDomainInTeam<D, T>, SendingDomainNotFound | DatabaseUnavailable, Sending> =>
  Effect.gen(function* () {
    const sending = yield* Sending
    const found = yield* sending.locateDomain(member.team.value, domain.value)
    if (!found) return yield* new SendingDomainNotFound({ team: member.teamName, sendingDomainId: domain.value })
    return SendingDomainInTeamProver.prove([domain, member.team], { team: member.team, domain, found })
  })
