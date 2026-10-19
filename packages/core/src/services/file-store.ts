import { Database, schema } from "@parley/db"
import type { DatabaseUnavailable, TeamId } from "@parley/domain"
import { AwsClient } from "aws4fetch"
import { eq } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import type { SqlError } from "effect/sql"
import { classifySqlError } from "./sql-errors.ts"

export interface StoredFile {
  readonly bytes: Uint8Array
  readonly contentType: string
}

/**
 * Where files live (D76): any S3-compatible store (S3, R2, MinIO…) when S3_BUCKET is set, else
 * Postgres. Process tier. Keys start with the team id, which is what access checks read.
 */
export class FileStore extends Context.Service<
  FileStore,
  {
    readonly put: (teamId: TeamId, key: string, file: StoredFile) => Effect.Effect<void, DatabaseUnavailable>
    readonly get: (key: string) => Effect.Effect<StoredFile | undefined, DatabaseUnavailable>
    readonly remove: (key: string) => Effect.Effect<void, DatabaseUnavailable>
  }
>()("@parley/core/FileStore") {
  static readonly layer = Layer.effect(
    FileStore,
    Effect.gen(function* () {
      const bucket = yield* Config.option(Config.String("S3_BUCKET")).pipe(Effect.orDie)
      if (Option.isSome(bucket)) {
        const endpoint = yield* Config.String("S3_ENDPOINT").pipe(Effect.orDie)
        const region = yield* Config.withDefault(Config.String("S3_REGION"), "auto").pipe(Effect.orDie)
        const accessKeyId = yield* Config.Redacted("S3_ACCESS_KEY_ID").pipe(Effect.orDie)
        const secretAccessKey = yield* Config.Redacted("S3_SECRET_ACCESS_KEY").pipe(Effect.orDie)
        const client = new AwsClient({
          accessKeyId: Redacted.value(accessKeyId),
          secretAccessKey: Redacted.value(secretAccessKey),
          service: "s3",
          region,
        })
        const url = (key: string) =>
          `${endpoint.replace(/\/$/, "")}/${bucket.value}/${key.split("/").map(encodeURIComponent).join("/")}`
        /** A storage failure is an outage we don't classify yet: a defect with a reference id (R29). */
        const call = <A>(thunk: () => Promise<A>) => Effect.tryPromise(thunk).pipe(Effect.orDie)
        return {
          put: (_teamId, key, file) =>
            call(async () => {
              const response = await client.fetch(url(key), {
                method: "PUT",
                headers: { "content-type": file.contentType },
                body: new Blob([file.bytes as Uint8Array<ArrayBuffer>]),
              })
              if (!response.ok) throw new Error(`S3 put failed: ${response.status}`)
            }),
          get: (key) =>
            isFileKey(key)
              ? call(async () => {
                  const response = await client.fetch(url(key))
                  if (response.status === 404) return undefined
                  if (!response.ok) throw new Error(`S3 get failed: ${response.status}`)
                  return {
                    bytes: new Uint8Array(await response.arrayBuffer()),
                    contentType: response.headers.get("content-type") ?? "application/octet-stream",
                  }
                })
              : Effect.succeed(undefined),
          remove: (key) =>
            call(async () => {
              await client.fetch(url(key), { method: "DELETE" })
            }),
        }
      }

      const db = yield* Database
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))
      return {
        put: (teamId, key, file) =>
          run(
            db.query((d) =>
              d
                .insert(schema.files)
                .values({
                  key,
                  teamId,
                  contentType: file.contentType,
                  data: Buffer.from(file.bytes).toString("base64"),
                })
                .onConflictDoUpdate({
                  target: schema.files.key,
                  set: { contentType: file.contentType, data: Buffer.from(file.bytes).toString("base64") },
                }),
            ),
          ).pipe(Effect.asVoid),
        get: (key) =>
          Effect.map(run(db.query((d) => d.select().from(schema.files).where(eq(schema.files.key, key)))), ([row]) =>
            row ? { bytes: new Uint8Array(Buffer.from(row.data, "base64")), contentType: row.contentType } : undefined,
          ),
        remove: (key) =>
          run(db.query((d) => d.delete(schema.files).where(eq(schema.files.key, key)))).pipe(Effect.asVoid),
      }
    }),
  )
}

/**
 * Every key Parley makes: `<team id>/avatars|logos/<record id>-<random>.webp`. Reads accept nothing
 * else, so a key can't climb out of its team (`a/../b`) in an S3 path.
 */
const KEY = /^[A-Za-z0-9_-]{1,64}\/(avatars|logos)\/[A-Za-z0-9-]{1,80}\.webp$/
export const isFileKey = (key: string) => KEY.test(key)

/** The URL the web app and agents fetch a file from. Access is checked when it's read. */
export const fileUrl = (key: string | null) => (key ? `/api/files/${key}` : null)
