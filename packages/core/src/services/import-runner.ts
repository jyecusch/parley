import { Database } from "@parley/db"
import type { FieldProblem, TeamId } from "@parley/domain"
import { type UserText, userText } from "@parley/errors"
import { sql } from "drizzle-orm"
import { Cause, Context, type Context as ContextType, Duration, Effect, Layer, Option } from "effect"
import type { SqlError } from "effect/sql"
import {
  fetchImportedLogo,
  type ImportSettings,
  importCompanyRows,
  importContactRows,
  type LogoToFetch,
  logoProblem,
} from "../operations/csv.ts"
import type { OperationServices } from "../operations/registry.ts"
import type { Principal } from "../principal.ts"
import { revivePrincipal, type UNFINISHED } from "./imports.ts"
import { classifySqlError } from "./sql-errors.ts"

/** A claim older than this is taken to be from a server that stopped, and another may take it over. */
const CLAIM_MINUTES = 2
/** The failed and warning rows an import keeps. */
const KEPT_ROWS = 1000

interface Claimed {
  readonly id: string
  readonly team_id: string
  readonly record_type: "contact" | "company"
  readonly status: (typeof UNFINISHED)[number]
  readonly options: ImportSettings
  readonly principal: unknown
}

type ProblemRows = ReadonlyArray<{ readonly line: number; readonly problems: ReadonlyArray<FieldProblem> }>

interface PartOutcome {
  readonly created: number
  readonly updated: number
  readonly failed: ProblemRows
  readonly warnings: ProblemRows
  readonly logos: ReadonlyArray<LogoToFetch>
}

/** Why a part couldn't be imported at all, as opposed to a row that failed. */
type PartFailure =
  | Effect.Error<ReturnType<typeof importContactRows>>
  | Effect.Error<ReturnType<typeof importCompanyRows>>

/** Rows from a raw query, however the driver shapes the result. */
const rowsOf = <A>(result: unknown): ReadonlyArray<A> =>
  Array.isArray(result) ? (result as ReadonlyArray<A>) : ((result as { readonly rows?: ReadonlyArray<A> }).rows ?? [])

/** Failures that mean whoever started the import can't add records to the team any more. */
const ACCESS_LOST: ReadonlySet<string> = new Set([
  "NotATeamMember",
  "RoleLacksPermission",
  "ServiceAccountRoleLacksPermission",
  "ApiKeyScopeExcludes",
  "ConnectionScopeExcludes",
  "ApiKeyNotValidForTeam",
  "ConnectionNotValidForTeam",
])

/** A list of problem rows, appended to a column and kept to the first KEPT_ROWS. */
const appended = (column: "failed" | "warnings", rows: ProblemRows) =>
  sql`(select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from (
    select e, n from jsonb_array_elements(${sql.raw(column)} || ${JSON.stringify(rows)}::jsonb) with ordinality as t(e, n)
    order by n limit ${KEPT_ROWS}) kept)`

/**
 * Carries out imports in the background (D135), one part of one import at a time, as whoever
 * started each. Process tier: shared by every team. Postgres holds the work, so a restart, or
 * another server, picks up at the next part; imports take turns, a part each.
 */
export class ImportRunner extends Context.Service<
  ImportRunner,
  {
    /** Imports one part, or fetches one logo, of the next import due. Whether there was one. */
    readonly step: Effect.Effect<boolean>
    /** Steps until nothing is due. For tests. */
    readonly drain: Effect.Effect<number>
  }
>()("@parley/core/ImportRunner") {
  static readonly layer = Layer.effect(
    ImportRunner,
    Effect.gen(function* () {
      const db = yield* Database
      const services: ContextType.Context<OperationServices> = yield* Effect.context<OperationServices>()
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))
      const execute = <A>(query: ReturnType<typeof sql>) =>
        run(db.query((d) => d.execute(query))).pipe(Effect.map((result) => rowsOf<A>(result)))

      const claim = execute<Claimed>(sql`
        update imports set claimed_at = now(),
          status = case when status = 'queued' then 'running' else status end
        where id = (
          select id from imports
          where status in ('queued', 'running', 'fetching-logos')
            and (claimed_at is null or claimed_at < now() - make_interval(mins => ${CLAIM_MINUTES}))
          order by updated_at limit 1
          for update skip locked)
        returning id, team_id, record_type, status, options, principal`).pipe(Effect.map(([row]) => row))

      // Turns are taken by updated_at, so a released import goes to the back.
      const release = (id: string) =>
        execute(sql`update imports set claimed_at = null, updated_at = now() where id = ${id}`).pipe(Effect.ignore)

      const finish = (id: string) =>
        run(
          db.transaction(
            Effect.gen(function* () {
              yield* db.query((d) =>
                d.execute(sql`update imports set status = 'finished', finished_at = now()
                  where id = ${id} and status in ('running', 'fetching-logos')`),
              )
              yield* db.query((d) => d.execute(sql`delete from import_parts where import_id = ${id}`))
              yield* db.query((d) => d.execute(sql`delete from import_logos where import_id = ${id}`))
            }),
          ),
        )

      const fail = (id: string, reason: UserText) =>
        run(
          db.transaction(
            Effect.gen(function* () {
              yield* db.query((d) =>
                d.execute(sql`update imports set status = 'failed', error = ${reason}, finished_at = now()
                  where id = ${id} and status in ('queued', 'running', 'fetching-logos')`),
              )
              yield* db.query((d) => d.execute(sql`delete from import_parts where import_id = ${id}`))
              yield* db.query((d) => d.execute(sql`delete from import_logos where import_id = ${id}`))
            }),
          ),
        )

      /**
       * Stops an import that can't go on, with why. A database outage stops nothing: the part is
       * tried again on a later turn.
       */
      const stop = (claimed: Claimed, principal: Principal, cause: Cause.Cause<unknown>) =>
        Effect.gen(function* () {
          const error = Option.getOrUndefined(Cause.findErrorOption(cause)) as
            | { readonly _tag?: string; readonly userMessage?: UserText }
            | undefined
          if (error?._tag === "DatabaseUnavailable") {
            return yield* Effect.logWarning("import waiting for the database", { importId: claimed.id })
          }
          if (error?._tag && ACCESS_LOST.has(error._tag)) {
            return yield* fail(
              claimed.id,
              userText`${principal.name} can't add records to this team any more, so the import stopped. Rows already imported stay.`,
            )
          }
          if (error?.userMessage) return yield* fail(claimed.id, error.userMessage)
          yield* Effect.logError("import failed", { importId: claimed.id, cause })
          return yield* fail(
            claimed.id,
            userText`Something went wrong, so the import stopped. Rows already imported stay.`,
          )
        })

      /** Adds a part's outcome and drops the part. Counts are added even if it was canceled meanwhile. */
      const record = (claimed: Claimed, partId: string, outcome: PartOutcome) =>
        run(
          db.transaction(
            Effect.gen(function* () {
              const [after] = rowsOf<{ status: string }>(
                yield* db.query((d) =>
                  d.execute(sql`update imports set
                    processed_rows = processed_rows + ${outcome.created + outcome.updated + outcome.failed.length},
                    created = created + ${outcome.created},
                    updated = updated + ${outcome.updated},
                    failed_count = failed_count + ${outcome.failed.length},
                    warning_count = warning_count + ${outcome.warnings.length},
                    failed = ${appended("failed", outcome.failed)},
                    warnings = ${appended("warnings", outcome.warnings)},
                    claimed_at = now()
                    where id = ${claimed.id} returning status`),
                ),
              )
              yield* db.query((d) => d.execute(sql`delete from import_parts where id = ${partId}`))
              if (after?.status !== "running" || outcome.logos.length === 0) return
              const values = sql.join(
                outcome.logos.map(
                  (logo) => sql`(${crypto.randomUUID()}, ${claimed.id}, ${logo.companyId}, ${logo.line}, ${logo.url})`,
                ),
                sql`, `,
              )
              yield* db.query((d) =>
                d.execute(sql`insert into import_logos (id, import_id, company_id, line, url) values ${values}`),
              )
            }),
          ),
        )

      /** Once every part is in: on to the logos, if there are any, or done. */
      const afterRows = (claimed: Claimed) =>
        Effect.gen(function* () {
          const [pending] = yield* execute<{ count: number | string }>(
            sql`select count(*) as count from import_logos where import_id = ${claimed.id}`,
          )
          const logos = Number(pending?.count ?? 0)
          if (logos === 0) return yield* finish(claimed.id)
          yield* execute(sql`update imports set status = 'fetching-logos', logos_total = ${logos}
            where id = ${claimed.id} and status = 'running'`)
        })

      const nextPart = (claimed: Claimed, principal: Principal) =>
        Effect.gen(function* () {
          const [part] = yield* execute<{ id: string; csv: string; first_line: number }>(
            sql`select id, csv, first_line from import_parts where import_id = ${claimed.id} order by position limit 1`,
          )
          if (!part) return yield* afterRows(claimed)
          const slice = { csv: part.csv, firstLine: part.first_line, maxRows: Number.POSITIVE_INFINITY }
          const teamId = claimed.team_id as TeamId
          const importer: Effect.Effect<PartOutcome, PartFailure, OperationServices> =
            claimed.record_type === "contact"
              ? importContactRows(principal, teamId, slice, claimed.options).pipe(
                  Effect.map((outcome) => ({ ...outcome, logos: [] })),
                )
              : importCompanyRows(principal, teamId, slice, claimed.options, "return")
          yield* importer.pipe(
            Effect.provideContext(services),
            Effect.matchCauseEffect({
              onSuccess: (outcome) => record(claimed, part.id, outcome),
              onFailure: (cause) => stop(claimed, principal, cause),
            }),
          )
        })

      const nextLogo = (claimed: Claimed, principal: Principal) =>
        Effect.gen(function* () {
          const [logo] = yield* execute<{ id: string; company_id: string; line: number; url: string }>(
            sql`select id, company_id, line, url from import_logos where import_id = ${claimed.id}
              order by line limit 1`,
          )
          if (!logo) return yield* finish(claimed.id)
          const target: LogoToFetch = { line: logo.line, companyId: logo.company_id as never, url: logo.url }
          yield* fetchImportedLogo(principal, claimed.team_id as TeamId, target).pipe(
            Effect.provideContext(services),
            Effect.matchCauseEffect({
              onSuccess: (fetched) => {
                const warnings = fetched ? [] : [{ line: logo.line, problems: [logoProblem()] }]
                return run(
                  db.transaction(
                    Effect.gen(function* () {
                      yield* db.query((d) =>
                        d.execute(sql`update imports set logos_done = logos_done + 1,
                          warning_count = warning_count + ${warnings.length},
                          warnings = ${appended("warnings", warnings)},
                          claimed_at = now()
                          where id = ${claimed.id}`),
                      )
                      yield* db.query((d) => d.execute(sql`delete from import_logos where id = ${logo.id}`))
                    }),
                  ),
                )
              },
              onFailure: (cause) => stop(claimed, principal, cause),
            }),
          )
        })

      const step = Effect.gen(function* () {
        const claimed = yield* claim
        if (!claimed) return false
        const principal = revivePrincipal(claimed.principal)
        yield* (claimed.status === "fetching-logos" ? nextLogo(claimed, principal) : nextPart(claimed, principal)).pipe(
          Effect.ensuring(release(claimed.id)),
        )
        return true
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("import runner failed", cause).pipe(Effect.andThen(Effect.succeed(false))),
        ),
        Effect.withSpan("ImportRunner.step"),
      )

      const drain = Effect.gen(function* () {
        let steps = 0
        while (yield* step) steps++
        return steps
      })

      return { step, drain }
    }),
  )

  /** Works through imports while there are any, checking for new ones every couple of seconds. */
  static readonly schedule = Layer.effectDiscard(
    Effect.gen(function* () {
      const runner = yield* ImportRunner
      yield* Effect.forkScoped(
        Effect.forever(
          runner.step.pipe(Effect.flatMap((worked) => (worked ? Effect.yieldNow : Effect.sleep(Duration.seconds(2))))),
        ),
      )
    }),
  )
}
