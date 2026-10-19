import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, TeamId, Template, TemplateId } from "@parley/domain"
import { and, desc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { CanWriteEmail, MemberOf } from "../proofs/permissions.ts"
import type { TemplateInTeam } from "../proofs/template-in-team.ts"
import { classifySqlError } from "./sql-errors.ts"

export interface ContentInput {
  readonly subject?: string | undefined
  readonly previewText?: string | undefined
  readonly body?: string | undefined
}

const toTemplate = (row: typeof schema.templates.$inferSelect): Template => ({
  id: row.id as TemplateId,
  name: row.name,
  subject: row.subject,
  previewText: row.previewText,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Templates (R41): reusable content a campaign starts from. Process tier. */
export class Templates extends Context.Service<
  Templates,
  {
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<Template>, DatabaseUnavailable>
    /** Used only by the TemplateInTeam prover. */
    readonly locate: (teamId: TeamId, id: TemplateId) => Effect.Effect<Template | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      access: CanWriteEmail<P, T>,
      input: ContentInput & { readonly name: string },
    ) => Effect.Effect<Template, DatabaseUnavailable>
    readonly update: <P, T, K>(
      target: TemplateInTeam<K, T>,
      input: ContentInput & { readonly name?: string | undefined },
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Template, DatabaseUnavailable>
    readonly delete: <P, T, K>(
      target: TemplateInTeam<K, T>,
      access: CanWriteEmail<P, T>,
    ) => Effect.Effect<Template, DatabaseUnavailable>
  }
>()("@parley/core/Templates") {
  static readonly layer = Layer.effect(
    Templates,
    Effect.gen(function* () {
      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))
      const byId = (teamId: string, id: string) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.templates)
              .where(and(eq(schema.templates.teamId, teamId), eq(schema.templates.id, id))),
          ),
        ).pipe(Effect.map(([row]) => (row ? toTemplate(row) : undefined)))
      const one = (teamId: string, id: string) =>
        Effect.flatMap(byId(teamId, id), (found) => (found ? Effect.succeed(found) : Effect.die(new Error("gone"))))

      return {
        list: (member) =>
          run(
            db.query((d) =>
              d
                .select()
                .from(schema.templates)
                .where(eq(schema.templates.teamId, member.team.value))
                .orderBy(desc(schema.templates.updatedAt)),
            ),
          ).pipe(Effect.map((rows) => rows.map(toTemplate))),
        locate: byId,
        create: (access, input) =>
          Effect.gen(function* () {
            const id = crypto.randomUUID()
            const teamId = access.member.team.value
            yield* run(
              db.query((d) =>
                d.insert(schema.templates).values({
                  id,
                  teamId,
                  name: input.name,
                  subject: input.subject ?? "",
                  previewText: input.previewText ?? "",
                  body: input.body ?? "",
                }),
              ),
            )
            return yield* one(teamId, id)
          }).pipe(Effect.withSpan("Templates.create")),
        update: (target, input) =>
          Effect.gen(function* () {
            const teamId = target.team.value
            yield* run(
              db.query((d) =>
                d
                  .update(schema.templates)
                  .set({
                    ...(input.name !== undefined ? { name: input.name } : {}),
                    ...(input.subject !== undefined ? { subject: input.subject } : {}),
                    ...(input.previewText !== undefined ? { previewText: input.previewText } : {}),
                    ...(input.body !== undefined ? { body: input.body } : {}),
                    updatedAt: sql`now()`,
                  })
                  .where(and(eq(schema.templates.teamId, teamId), eq(schema.templates.id, target.template.value))),
              ),
            )
            return yield* one(teamId, target.template.value)
          }).pipe(Effect.withSpan("Templates.update")),
        delete: (target) =>
          Effect.gen(function* () {
            yield* run(
              db.query((d) =>
                d
                  .delete(schema.templates)
                  .where(
                    and(eq(schema.templates.teamId, target.team.value), eq(schema.templates.id, target.template.value)),
                  ),
              ),
            )
            return target.found
          }).pipe(Effect.withSpan("Templates.delete")),
      }
    }),
  )
}
