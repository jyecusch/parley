import { Database, schema } from "@parley/db"
import {
  CustomHtmlMissingContent,
  type DatabaseUnavailable,
  type EmailFont,
  type EmailStyle,
  type EmailStyleColors,
  type EmailStyleId,
  EmailStyleInUse,
  EmailStyleIsDefault,
  type EmailStyleLayout,
  type ImageTooLarge,
  type ImageUnreadable,
  PLAIN_COLORS,
  type TeamId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { and, asc, count, eq, inArray, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import type { RenderStyle } from "../email/render.ts"
import type { EmailStyleInTeam } from "../proofs/email-style-in-team.ts"
import type { CanManageEmail, MemberOf } from "../proofs/permissions.ts"
import { EmailImages } from "./email-images.ts"
import { classifySqlError } from "./sql-errors.ts"

type Row = typeof schema.emailStyles.$inferSelect

/** What a style sets. Undefined leaves a field as it is; null removes the logo, header line or custom HTML. */
export interface StyleInput {
  readonly layout?: EmailStyleLayout | undefined
  /** A new logo as base64 or a data: URL, or null to remove it. */
  readonly logo?: string | null | undefined
  readonly logoAlign?: "left" | "center" | undefined
  readonly headerText?: string | null | undefined
  readonly footerAlign?: "left" | "center" | "right" | undefined
  readonly colors?: EmailStyleColors | undefined
  readonly font?: EmailFont | undefined
  readonly customHtml?: string | null | undefined
}

/** Where custom HTML puts the email's body. The renderer fills the same slot. */
export const CONTENT_SLOT = /\{\{\s*content\s*\}\}/

/** Custom HTML must have somewhere to put the body, or emails would go out empty. */
export const checkCustomHtml = (layout: EmailStyleLayout, customHtml: string | null) =>
  layout === "custom" && !(customHtml && CONTENT_SLOT.test(customHtml))
    ? Effect.fail(new CustomHtmlMissingContent())
    : Effect.void

/** The name a team's first style gets, before anyone changes it (D115). */
const PLAIN_NAME = "Plain"

/**
 * Email styles (D116): how a team's emails look. Every team has at least one, and exactly one is
 * its default, which templates and broadcasts without a style of their own use (D117). Process tier.
 */
export class EmailStyles extends Context.Service<
  EmailStyles,
  {
    readonly list: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<EmailStyle>, DatabaseUnavailable>
    /** Used only by the EmailStyleInTeam and EmailStyleOfTeam provers. */
    readonly locate: (teamId: TeamId, id: EmailStyleId) => Effect.Effect<EmailStyle | undefined, DatabaseUnavailable>
    readonly create: <P, T>(
      access: CanManageEmail<P, T>,
      input: StyleInput & { readonly name: string },
    ) => Effect.Effect<EmailStyle, CustomHtmlMissingContent | ImageUnreadable | ImageTooLarge | DatabaseUnavailable>
    readonly update: <P, T, S>(
      target: EmailStyleInTeam<S, T>,
      input: StyleInput & { readonly name?: string | undefined },
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<EmailStyle, CustomHtmlMissingContent | ImageUnreadable | ImageTooLarge | DatabaseUnavailable>
    readonly setDefault: <P, T, S>(
      target: EmailStyleInTeam<S, T>,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<EmailStyle, DatabaseUnavailable>
    readonly delete: <P, T, S>(
      target: EmailStyleInTeam<S, T>,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<EmailStyle, EmailStyleIsDefault | EmailStyleInUse | DatabaseUnavailable>
    /**
     * The look an email renders with: the style named, else the team's default. A style that's
     * gone (deleted since) also falls back to the default.
     */
    readonly renderStyle: (
      teamId: TeamId,
      styleId: EmailStyleId | null,
    ) => Effect.Effect<RenderStyle, DatabaseUnavailable>
  }
>()("@parley/core/EmailStyles") {
  static readonly layer = Layer.effect(
    EmailStyles,
    Effect.gen(function* () {
      const db = yield* Database
      const images = yield* EmailImages
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const lookOf = (row: Row): RenderStyle => ({
        layout: row.layout,
        logoUrl: row.logoKey ? images.urlOf(row.logoKey) : null,
        logoAlign: row.logoAlign,
        headerText: row.headerText,
        footerAlign: row.footerAlign,
        colors: row.colors,
        font: row.font,
        customHtml: row.customHtml,
      })

      const toStyle = (row: Row, usedBy: { templates: number; broadcasts: number }): EmailStyle => ({
        id: row.id as EmailStyleId,
        name: row.name,
        isDefault: row.isDefault,
        ...lookOf(row),
        usedBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })

      /**
       * Gives a team its plain default if it has none. Teams are created in more than one place
       * (Better-Auth's API, and earlier than email styles existed), so every read makes sure.
       */
      const ensureDefault = (teamId: string) =>
        run(
          db.query((d) =>
            d.execute(sql`
              insert into "email_styles" (id, team_id, name, is_default, layout, colors, font)
              select gen_random_uuid(), ${teamId}, ${PLAIN_NAME}, true, 'plain', ${JSON.stringify(PLAIN_COLORS)}::jsonb, 'default'
              where not exists (select 1 from "email_styles" where team_id = ${teamId} and is_default)
              on conflict do nothing`),
          ),
        ).pipe(Effect.asVoid)

      /** How many templates and draft broadcasts name each style. Sent broadcasts keep their own copy. */
      const usageOf = (ids: ReadonlyArray<string>) =>
        ids.length === 0
          ? Effect.succeed(new Map<string, { templates: number; broadcasts: number }>())
          : Effect.gen(function* () {
              const [templates, broadcasts] = yield* Effect.all([
                run(
                  db.query((d) =>
                    d
                      .select({ styleId: schema.templates.styleId, count: count() })
                      .from(schema.templates)
                      .where(inArray(schema.templates.styleId, [...ids]))
                      .groupBy(schema.templates.styleId),
                  ),
                ),
                run(
                  db.query((d) =>
                    d
                      .select({ styleId: schema.broadcasts.styleId, count: count() })
                      .from(schema.broadcasts)
                      .where(and(inArray(schema.broadcasts.styleId, [...ids]), eq(schema.broadcasts.status, "draft")))
                      .groupBy(schema.broadcasts.styleId),
                  ),
                ),
              ])
              const usage = new Map(ids.map((id) => [id, { templates: 0, broadcasts: 0 }]))
              for (const row of templates) {
                const entry = row.styleId ? usage.get(row.styleId) : undefined
                if (entry) entry.templates = Number(row.count)
              }
              for (const row of broadcasts) {
                const entry = row.styleId ? usage.get(row.styleId) : undefined
                if (entry) entry.broadcasts = Number(row.count)
              }
              return usage
            })

      const rowOf = (teamId: string, id: string) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.emailStyles)
              .where(and(eq(schema.emailStyles.teamId, teamId), eq(schema.emailStyles.id, id))),
          ),
        ).pipe(Effect.map(([row]) => row))

      const locate = (teamId: string, id: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(teamId, id)
          if (!row) return undefined
          const usage = yield* usageOf([row.id])
          return toStyle(row, usage.get(row.id) ?? { templates: 0, broadcasts: 0 })
        })

      const one = (teamId: string, id: string) =>
        Effect.flatMap(locate(teamId, id), (found) =>
          found ? Effect.succeed(found) : Effect.die(new Error("email style vanished")),
        )

      /** A new logo is stored as an email image; null removes it (the image stays, for emails already sent). */
      const logoKeyOf = (teamId: TeamId, logo: string | null | undefined) =>
        logo === undefined
          ? Effect.succeed(undefined)
          : logo === null
            ? Effect.succeed(null)
            : Effect.map(images.fromUpload(teamId, logo), (image) => image.fileKey)

      const list = <P, T>(member: MemberOf<P, T>) =>
        Effect.gen(function* () {
          const teamId = member.team.value
          yield* ensureDefault(teamId)
          const rows = yield* run(
            db.query((d) =>
              d
                .select()
                .from(schema.emailStyles)
                .where(eq(schema.emailStyles.teamId, teamId))
                .orderBy(sql`${schema.emailStyles.isDefault} desc`, asc(schema.emailStyles.name)),
            ),
          )
          const usage = yield* usageOf(rows.map((row) => row.id))
          return rows.map((row) => toStyle(row, usage.get(row.id) ?? { templates: 0, broadcasts: 0 }))
        })

      const create = <P, T>(access: CanManageEmail<P, T>, input: StyleInput & { readonly name: string }) =>
        Effect.gen(function* () {
          const teamId = access.member.team.value
          const layout = input.layout ?? "plain"
          const customHtml = input.customHtml ?? null
          yield* checkCustomHtml(layout, customHtml)
          const logoKey = yield* logoKeyOf(teamId, input.logo)
          yield* ensureDefault(teamId)
          const id = crypto.randomUUID()
          yield* run(
            db.query((d) =>
              d.insert(schema.emailStyles).values({
                id,
                teamId,
                name: input.name,
                layout,
                logoKey: logoKey ?? null,
                logoAlign: input.logoAlign ?? "left",
                footerAlign: input.footerAlign ?? "left",
                headerText: input.headerText || null,
                colors: input.colors ?? PLAIN_COLORS,
                font: input.font ?? "default",
                customHtml,
              }),
            ),
          )
          return yield* one(teamId, id)
        }).pipe(Effect.withSpan("EmailStyles.create"))

      const update = <T, S>(
        target: EmailStyleInTeam<S, T>,
        input: StyleInput & { readonly name?: string | undefined },
      ) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          const found = target.found
          const layout = input.layout ?? found.layout
          const customHtml = input.customHtml === undefined ? found.customHtml : input.customHtml
          yield* checkCustomHtml(layout, customHtml)
          const logoKey = yield* logoKeyOf(teamId, input.logo)
          yield* run(
            db.query((d) =>
              d
                .update(schema.emailStyles)
                .set({
                  ...(input.name !== undefined ? { name: input.name } : {}),
                  ...(input.layout !== undefined ? { layout: input.layout } : {}),
                  ...(logoKey !== undefined ? { logoKey } : {}),
                  ...(input.logoAlign !== undefined ? { logoAlign: input.logoAlign } : {}),
                  ...(input.footerAlign !== undefined ? { footerAlign: input.footerAlign } : {}),
                  ...(input.headerText !== undefined ? { headerText: input.headerText || null } : {}),
                  ...(input.colors !== undefined ? { colors: input.colors } : {}),
                  ...(input.font !== undefined ? { font: input.font } : {}),
                  ...(input.customHtml !== undefined ? { customHtml: input.customHtml } : {}),
                  updatedAt: sql`now()`,
                })
                .where(and(eq(schema.emailStyles.teamId, teamId), eq(schema.emailStyles.id, target.style.value))),
            ),
          )
          return yield* one(teamId, target.style.value)
        }).pipe(Effect.withSpan("EmailStyles.update"))

      const setDefault = <T, S>(target: EmailStyleInTeam<S, T>) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          // Clear the old default first: the partial unique index allows one default per team.
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d
                    .update(schema.emailStyles)
                    .set({ isDefault: false, updatedAt: sql`now()` })
                    .where(and(eq(schema.emailStyles.teamId, teamId), eq(schema.emailStyles.isDefault, true))),
                )
                yield* db.query((d) =>
                  d
                    .update(schema.emailStyles)
                    .set({ isDefault: true, updatedAt: sql`now()` })
                    .where(and(eq(schema.emailStyles.teamId, teamId), eq(schema.emailStyles.id, target.style.value))),
                )
              }),
            ),
          )
          return yield* one(teamId, target.style.value)
        }).pipe(Effect.withSpan("EmailStyles.setDefault"))

      const remove = <T, S>(target: EmailStyleInTeam<S, T>) =>
        Effect.gen(function* () {
          const found = target.found
          const style = DisplayName.fromRecord(found.name)
          if (found.isDefault) return yield* new EmailStyleIsDefault({ style })
          if (found.usedBy.templates > 0 || found.usedBy.broadcasts > 0) {
            return yield* new EmailStyleInUse({ style, ...found.usedBy })
          }
          yield* run(
            db.query((d) =>
              d
                .delete(schema.emailStyles)
                .where(
                  and(
                    eq(schema.emailStyles.teamId, target.team.value),
                    eq(schema.emailStyles.id, target.style.value),
                    eq(schema.emailStyles.isDefault, false),
                  ),
                ),
            ),
          )
          return found
        }).pipe(Effect.withSpan("EmailStyles.delete"))

      const renderStyle = (teamId: TeamId, styleId: EmailStyleId | null) =>
        Effect.gen(function* () {
          const named = styleId ? yield* rowOf(teamId, styleId) : undefined
          if (named) return lookOf(named)
          yield* ensureDefault(teamId)
          const [fallback] = yield* run(
            db.query((d) =>
              d
                .select()
                .from(schema.emailStyles)
                .where(and(eq(schema.emailStyles.teamId, teamId), eq(schema.emailStyles.isDefault, true))),
            ),
          )
          if (!fallback) return yield* Effect.die(new Error("team has no default email style"))
          return lookOf(fallback)
        })

      return {
        list,
        locate,
        create,
        update: (target, input) => update(target, input),
        setDefault: (target) => setDefault(target),
        delete: (target) => remove(target),
        renderStyle,
      }
    }),
  )
}
