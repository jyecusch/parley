import type {
  CompanyId,
  CompanyNotFound,
  ContactId,
  ContactNotFound,
  DatabaseUnavailable,
  RecordType,
  TeamId,
} from "@parley/domain"
import { Effect } from "effect"
import type { Companies } from "../services/companies.ts"
import type { Contacts } from "../services/contacts.ts"
import { proveCompanyInTeam } from "./company-in-team.ts"
import { proveContactInTeam } from "./contact-in-team.ts"
import type { CanReadRecords } from "./permissions.ts"
import { defineProof, type Named, named, type Proof } from "./proof.ts"

const RecordInTeamProver = defineProof("RecordInTeam")

/** A live contact or company is in team T. For things that hang off either, like notes. */
export interface RecordInTeam<T> extends Proof<"RecordInTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly recordType: RecordType
  readonly recordId: string
}

export const proveRecordInTeam = <P, T>(
  team: Named<T, TeamId>,
  recordType: RecordType,
  recordId: string,
  read: CanReadRecords<P, T>,
): Effect.Effect<RecordInTeam<T>, ContactNotFound | CompanyNotFound | DatabaseUnavailable, Contacts | Companies> =>
  Effect.gen(function* () {
    if (recordType === "contact") {
      // Only that it holds matters here; the record's name can't leave its scope.
      yield* named(recordId as ContactId, (contact) => Effect.asVoid(proveContactInTeam(team, contact, read)))
    } else {
      yield* named(recordId as CompanyId, (company) => Effect.asVoid(proveCompanyInTeam(team, company, read)))
    }
    return RecordInTeamProver.prove([team], { team, recordType, recordId })
  })
