import {
  type cancelImport,
  type getImport,
  IMPORT_MAX_ROWS,
  InputRejected,
  type listImports,
  type OperationInput,
  parseCsv,
  type startImport,
} from "@parley/domain"
import { userText } from "@parley/errors"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveImportInTeam } from "../proofs/import-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Imports } from "../services/imports.ts"
import { checkImportSettings } from "./csv.ts"

/** Rows in each part of an import's file: imported together, so a restart repeats at most one part. */
export const PART_ROWS = 250

/** A row as CSV, quoted only where it must be. Unlike export, cells are kept exactly as they were. */
const csvLine = (cells: ReadonlyArray<string>) =>
  cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")

const rejected = (problem: "missing" | "too-long", message: ReturnType<typeof userText>) =>
  new InputRejected({ problems: [{ field: "csv", problem, userMessage: message }] })

export const start = (principal: Principal, input: OperationInput<typeof startImport>) =>
  named(principal, input.teamId, (named, team) =>
    Effect.gen(function* () {
      const imports = yield* Imports
      const member = yield* proveMemberOf(named, team)
      const canWrite = yield* proveCanWriteRecords(member)
      const [headers = [], ...rows] = parseCsv(input.csv)
      if (headers.length === 0 || rows.length === 0) {
        return yield* rejected("missing", userText`This file has no rows to import. Add a header row and some rows.`)
      }
      if (rows.length > IMPORT_MAX_ROWS) {
        return yield* rejected(
          "too-long",
          userText`Import up to ${IMPORT_MAX_ROWS} rows at a time. Split the file and import each part.`,
        )
      }
      const settings = {
        mapping: input.mapping,
        set: input.set,
        owners: input.owners,
        multiSelect: input.multiSelect,
      }
      const mapping = yield* checkImportSettings(principal, input.teamId, input.recordType, headers, settings)
      const header = csvLine(headers)
      const parts: Array<{ csv: string; firstLine: number }> = []
      for (let from = 0; from < rows.length; from += PART_ROWS) {
        const slice = rows.slice(from, from + PART_ROWS)
        parts.push({ csv: [header, ...slice.map(csvLine)].join("\r\n"), firstLine: from + 2 })
      }
      return yield* imports.start(canWrite, {
        recordType: input.recordType,
        fileName: input.fileName,
        options: { ...settings, mapping },
        totalRows: rows.length,
        parts,
      })
    }),
  )

export const get = (principal: Principal, input: OperationInput<typeof getImport>) =>
  named(principal, input.teamId, input.importId, (principal, team, target) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const found = yield* proveImportInTeam(member, target)
      return found.found
    }),
  )

export const list = (principal: Principal, input: OperationInput<typeof listImports>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const imports = yield* Imports
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      return yield* imports.list(team, input.recordType, canRead)
    }),
  )

export const cancel = (principal: Principal, input: OperationInput<typeof cancelImport>) =>
  named(principal, input.teamId, input.importId, (principal, team, target) =>
    Effect.gen(function* () {
      const imports = yield* Imports
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const found = yield* proveImportInTeam(member, target)
      return yield* imports.cancel(found, canWrite)
    }),
  )
