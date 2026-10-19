import { type DatabaseUnavailable, type ServiceAccount, ServiceAccountNotFound, type UserId } from "@parley/domain"
import { Effect } from "effect"
import { ServiceAccounts } from "../services/service-accounts.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const ServiceAccountInTeamProver = defineProof("ServiceAccountInTeam")

/** S is a service account and a member of team T, which member P can see. */
export interface ServiceAccountInTeam<P, T, S> extends Proof<"ServiceAccountInTeam", [P, T, S]> {
  readonly member: MemberOf<P, T>
  readonly serviceAccount: Named<S, UserId>
  readonly found: ServiceAccount
}

/** A person, or a service account in another team, is simply not found. */
export const proveServiceAccountInTeam = <P, T, S>(
  member: MemberOf<P, T>,
  serviceAccount: Named<S, UserId>,
): Effect.Effect<ServiceAccountInTeam<P, T, S>, ServiceAccountNotFound | DatabaseUnavailable, ServiceAccounts> =>
  Effect.gen(function* () {
    const serviceAccounts = yield* ServiceAccounts
    const found = yield* serviceAccounts.locate(member, serviceAccount.value)
    if (!found) return yield* new ServiceAccountNotFound({ serviceAccountId: serviceAccount.value })
    return {
      ...ServiceAccountInTeamProver.prove(member.principal, member.team, serviceAccount),
      member,
      serviceAccount,
      found,
    }
  })
