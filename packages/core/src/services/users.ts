import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, UserId } from "@parley/domain"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { classifySqlError } from "./sql-errors.ts"

export interface UserRecord {
  readonly name: string
  readonly email: string
  readonly kind: "user" | "service-account"
}

/** Reads users. Used by the Authenticator to name the principal behind an API key. */
export class Users extends Context.Service<
  Users,
  { readonly find: (userId: UserId) => Effect.Effect<UserRecord | undefined, DatabaseUnavailable> }
>()("@parley/core/Users") {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const db = yield* Database
      const find = Effect.fn("Users.find")(function* (userId: UserId) {
        const [row] = yield* db
          .query((d) =>
            d
              .select({ name: schema.user.name, email: schema.user.email, kind: schema.user.kind })
              .from(schema.user)
              .where(eq(schema.user.id, userId)),
          )
          .pipe(Effect.catchTag("SqlError", classifySqlError))
        if (!row) return undefined
        return {
          name: row.name,
          email: row.email,
          kind: row.kind === "service-account" ? "service-account" : "user",
        } satisfies UserRecord
      })
      return { find }
    }),
  )
}
