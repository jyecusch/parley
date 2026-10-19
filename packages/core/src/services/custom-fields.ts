import { Database, schema } from "@parley/db"
import {
  BUILT_IN_FIELD_NAMES,
  type CustomField,
  type CustomFieldId,
  CustomFieldNameTaken,
  type CustomFieldType,
  type CustomValue,
  type CustomValues,
  type CustomValuesPatch,
  checkCustomValue,
  type DatabaseUnavailable,
  type FieldProblem,
  InputRejected,
  type RecordType,
  type SelectOption,
  type TeamId,
} from "@parley/domain"
import { EchoedInput, userText } from "@parley/errors"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { CustomFieldInTeam } from "../proofs/custom-field-in-team.ts"
import type { CanManageFields, CanReadRecords } from "../proofs/permissions.ts"
import type { Named } from "../proofs/proof.ts"
import { classifySqlError, isUniqueViolation } from "./sql-errors.ts"

const NAMES_KEY = "custom_fields_team_id_record_type_name_key"

const summarize = (row: typeof schema.customFields.$inferSelect): CustomField => ({
  id: row.id as CustomFieldId,
  recordType: row.recordType,
  name: row.name,
  type: row.type as CustomFieldType,
  options: row.options,
  position: row.position,
})

const isSelect = (type: CustomFieldType) => type === "single-select" || type === "multi-select"

/** Which table holds a record type's values. Fixed names only, never input. */
const valuesTable = (recordType: RecordType) =>
  recordType === "contact" ? sql.raw('"contacts"') : sql.raw('"companies"')

/** The result of applying a values patch: the new values, and the names of the fields that changed. */
export interface AppliedValues {
  readonly values: CustomValues
  readonly changed: ReadonlyArray<string>
}

const problemWords = {
  "wrong-type": userText`This isn't the right kind of value for this field.`,
  "invalid-format": userText`This value doesn't fit this field. Check it and try again.`,
  "too-long": userText`This is too long for this field. Shorten it and try again.`,
}

/** Custom fields on contacts and companies (D31, D32, D68). */
export class CustomFields extends Context.Service<
  CustomFields,
  {
    readonly list: <P, T>(
      team: Named<T, TeamId>,
      recordType: RecordType | undefined,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<ReadonlyArray<CustomField>, DatabaseUnavailable>
    /** Used only by the CustomFieldInTeam prover. */
    readonly locate: <P, T>(
      team: Named<T, TeamId>,
      fieldId: CustomFieldId,
      access: CanReadRecords<P, T>,
    ) => Effect.Effect<CustomField | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      team: Named<T, TeamId>,
      input: {
        readonly recordType: RecordType
        readonly name: string
        readonly type: CustomFieldType
        readonly options: ReadonlyArray<SelectOption>
      },
      access: CanManageFields<P, T>,
    ) => Effect.Effect<CustomField, CustomFieldNameTaken | InputRejected | DatabaseUnavailable>
    readonly update: <P, T, F>(
      target: CustomFieldInTeam<F, T>,
      input: {
        readonly name?: string | undefined
        readonly options?: ReadonlyArray<SelectOption> | undefined
        readonly position?: number | undefined
      },
      access: CanManageFields<P, T>,
    ) => Effect.Effect<CustomField, CustomFieldNameTaken | InputRejected | DatabaseUnavailable>
    readonly delete: <P, T, F>(
      target: CustomFieldInTeam<F, T>,
      access: CanManageFields<P, T>,
    ) => Effect.Effect<CustomField, DatabaseUnavailable>
    /** A team's fields for one record type. For services that check filters and values themselves. */
    readonly ofTeam: (
      teamId: TeamId,
      recordType: RecordType,
    ) => Effect.Effect<ReadonlyArray<CustomField>, DatabaseUnavailable>
    /**
     * Applies a patch of values to a record's current values, checking each against its field.
     * Used by Contacts and Companies inside their own proven writes.
     */
    readonly apply: (
      teamId: TeamId,
      recordType: RecordType,
      current: CustomValues,
      patch: CustomValuesPatch,
    ) => Effect.Effect<AppliedValues, InputRejected | DatabaseUnavailable>
  }
>()("@parley/core/CustomFields") {
  static readonly layer = Layer.effect(
    CustomFields,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const fieldsOf = (teamId: TeamId, recordType: RecordType | undefined) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.customFields)
              .where(
                and(
                  eq(schema.customFields.teamId, teamId),
                  recordType ? eq(schema.customFields.recordType, recordType) : undefined,
                ),
              )
              .orderBy(
                asc(schema.customFields.recordType),
                asc(schema.customFields.position),
                asc(schema.customFields.createdAt),
              ),
          ),
        ).pipe(Effect.map((rows) => rows.map(summarize)))

      /** Built-in names first (D68); clashes with other custom fields come from the unique index. */
      const checkName = (recordType: RecordType, name: string) =>
        BUILT_IN_FIELD_NAMES[recordType].includes(name.trim().toLowerCase())
          ? Effect.fail(new CustomFieldNameTaken({ name: EchoedInput.fromRequest(name), recordType, builtIn: true }))
          : Effect.void

      const checkOptions = (type: CustomFieldType, options: ReadonlyArray<SelectOption>) => {
        const problems: Array<FieldProblem> = []
        if (isSelect(type) && options.length === 0) {
          problems.push({
            field: "options",
            problem: "missing",
            userMessage: userText`Add at least one option for a select field.`,
          })
        }
        if (!isSelect(type) && options.length > 0) {
          problems.push({
            field: "options",
            problem: "not-allowed",
            userMessage: userText`Only select fields have options.`,
          })
        }
        const ids = new Set<string>()
        const labels = new Set<string>()
        options.forEach((option, index) => {
          if (ids.has(option.id) || labels.has(option.label.toLowerCase())) {
            problems.push({
              field: `options.${index}`,
              problem: "conflict",
              userMessage: userText`Each option needs its own name.`,
            })
          }
          ids.add(option.id)
          labels.add(option.label.toLowerCase())
        })
        return problems.length > 0 ? Effect.fail(new InputRejected({ problems })) : Effect.void
      }

      const nameTaken =
        (recordType: RecordType, name: string) =>
        (error: SqlError.SqlError): Effect.Effect<never, CustomFieldNameTaken | DatabaseUnavailable> =>
          isUniqueViolation(error, NAMES_KEY)
            ? Effect.fail(new CustomFieldNameTaken({ name: EchoedInput.fromRequest(name), recordType, builtIn: false }))
            : classifySqlError(error)

      const byId = (id: string) =>
        Effect.flatMap(
          run(db.query((d) => d.select().from(schema.customFields).where(eq(schema.customFields.id, id)))),
          ([row]) => (row ? Effect.succeed(summarize(row)) : Effect.die(`custom field ${id} vanished`)),
        )

      const list = <P, T>(team: Named<T, TeamId>, recordType: RecordType | undefined, _access: CanReadRecords<P, T>) =>
        fieldsOf(team.value, recordType)

      const locate = <P, T>(team: Named<T, TeamId>, fieldId: CustomFieldId, _access: CanReadRecords<P, T>) =>
        Effect.map(
          run(
            db.query((d) =>
              d
                .select()
                .from(schema.customFields)
                .where(
                  and(eq(schema.customFields.teamId, team.value), sql`${schema.customFields.id}::text = ${fieldId}`),
                ),
            ),
          ),
          ([row]) => (row ? summarize(row) : undefined),
        )

      const create = <P, T>(
        team: Named<T, TeamId>,
        input: {
          readonly recordType: RecordType
          readonly name: string
          readonly type: CustomFieldType
          readonly options: ReadonlyArray<SelectOption>
        },
        _access: CanManageFields<P, T>,
      ) =>
        Effect.gen(function* () {
          yield* checkName(input.recordType, input.name)
          yield* checkOptions(input.type, input.options)
          const existing = yield* fieldsOf(team.value, input.recordType)
          const id = crypto.randomUUID()
          yield* db
            .query((d) =>
              d.insert(schema.customFields).values({
                id,
                teamId: team.value,
                recordType: input.recordType,
                name: input.name,
                type: input.type,
                options: [...input.options],
                position: existing.length,
              }),
            )
            .pipe(Effect.catchTag("SqlError", nameTaken(input.recordType, input.name)))
          return yield* byId(id)
        }).pipe(Effect.withSpan("CustomFields.create"))

      const update = <P, T, F>(
        target: CustomFieldInTeam<F, T>,
        input: {
          readonly name?: string | undefined
          readonly options?: ReadonlyArray<SelectOption> | undefined
          readonly position?: number | undefined
        },
        _access: CanManageFields<P, T>,
      ) =>
        Effect.gen(function* () {
          const field = target.found
          const teamId = target.team.value
          if (input.name !== undefined) yield* checkName(field.recordType, input.name)
          if (input.options !== undefined) yield* checkOptions(field.type, input.options)
          const keep = new Set((input.options ?? field.options).map((option) => option.id))
          const removed = field.options.map((option) => option.id).filter((id) => !keep.has(id))
          const table = valuesTable(field.recordType)
          yield* db
            .transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.customFields)
                    .set({
                      ...(input.name !== undefined ? { name: input.name } : {}),
                      ...(input.options !== undefined ? { options: [...input.options] } : {}),
                      ...(input.position !== undefined ? { position: input.position } : {}),
                      updatedAt: sql`now()`,
                    })
                    .where(eq(schema.customFields.id, field.id)),
                )
                if (removed.length === 0) return
                // A removed option is cleared from every record that had it.
                const removedArray = sql`array[${sql.join(
                  removed.map((id) => sql`${id}`),
                  sql`, `,
                )}]::text[]`
                if (field.type === "single-select") {
                  yield* db.query((d) =>
                    d.execute(
                      sql`update ${table} set custom = custom - ${field.id}::text
                        where team_id = ${teamId} and custom->>${field.id}::text = any(${removedArray})`,
                    ),
                  )
                } else {
                  yield* db.query((d) =>
                    d.execute(
                      sql`update ${table} set custom = jsonb_set(custom, array[${field.id}::text], (
                          select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(custom->${field.id}::text) e
                          where not ((e #>> '{}') = any(${removedArray}))))
                        where team_id = ${teamId} and jsonb_typeof(custom->${field.id}::text) = 'array'`,
                    ),
                  )
                }
              }),
            )
            .pipe(Effect.catchTag("SqlError", nameTaken(field.recordType, input.name ?? field.name)))
          return yield* byId(field.id)
        }).pipe(Effect.withSpan("CustomFields.update"))

      const remove = <P, T, F>(target: CustomFieldInTeam<F, T>, _access: CanManageFields<P, T>) =>
        Effect.gen(function* () {
          const field = target.found
          const table = valuesTable(field.recordType)
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) => d.delete(schema.customFields).where(eq(schema.customFields.id, field.id)))
                yield* db.query((d) =>
                  d.execute(
                    sql`update ${table} set custom = custom - ${field.id}::text
                      where team_id = ${target.team.value} and custom ? ${field.id}::text`,
                  ),
                )
              }),
            ),
          )
          return field
        }).pipe(Effect.withSpan("CustomFields.delete"))

      const apply = (teamId: TeamId, recordType: RecordType, current: CustomValues, patch: CustomValuesPatch) =>
        Effect.gen(function* () {
          const entries = Object.entries(patch)
          if (entries.length === 0) return { values: current, changed: [] } satisfies AppliedValues
          const fields = new Map((yield* fieldsOf(teamId, recordType)).map((field) => [field.id as string, field]))
          const problems: Array<FieldProblem> = []
          const values: Record<string, CustomValue> = { ...current }
          const changed: Array<string> = []
          for (const [fieldId, value] of entries) {
            const field = fields.get(fieldId)
            if (!field) {
              problems.push({
                field: `custom.${fieldId}`,
                problem: "not-allowed",
                userMessage: userText`There's no such field. List fields to see the current ones.`,
              })
              continue
            }
            const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0)
            if (empty) {
              if (fieldId in values) changed.push(field.name)
              delete values[fieldId]
              continue
            }
            const problem = checkCustomValue(field, value)
            if (problem) {
              problems.push({ field: `custom.${fieldId}`, problem, userMessage: problemWords[problem] })
              continue
            }
            if (JSON.stringify(values[fieldId]) !== JSON.stringify(value)) changed.push(field.name)
            values[fieldId] = value
          }
          if (problems.length > 0) return yield* new InputRejected({ problems })
          return { values, changed } satisfies AppliedValues
        })

      return { list, locate, create, update, delete: remove, apply, ofTeam: fieldsOf }
    }),
  )
}
