import { Database, schema } from "@parley/db"
import {
  type DatabaseUnavailable,
  type EmailImageId,
  type ImageTooLarge,
  type ImageUnreadable,
  ImageUrlUnreachable,
  type TeamId,
} from "@parley/domain"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { PublicUrl } from "../config/public-url.ts"
import { bytesOf, type EmailImageFile, prepareEmailImage } from "../files/images.ts"
import { safeFetch } from "../files/safe-fetch.ts"
import { FileStore, type StoredFile } from "./file-store.ts"
import { classifySqlError } from "./sql-errors.ts"

/** The most an imported image may weigh before it's processed, like an upload. */
const IMPORT_MAX_BYTES = 10 * 1024 * 1024
/** Fetching an image, redirects included, gives up after this. */
const IMPORT_DEADLINE_MS = 15_000

/** An image hosted for email, as stored. */
export interface HostedEmailImage {
  readonly id: EmailImageId
  /** The absolute public address to put in an email. */
  readonly url: string
  /** Where the bytes are in the file store, for things that keep a reference (a style's logo). */
  readonly fileKey: string
  readonly width: number
  readonly height: number
  readonly createdAt: string
}

const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The id of an email image from its file key (`<team>/email-images/<id>.png`). */
const idOfKey = (fileKey: string) => fileKey.slice(fileKey.lastIndexOf("/") + 1).replace(/\.(png|jpg)$/, "")

/**
 * Images hosted by Parley for use in emails (D120): uploaded or copied from a public address,
 * prepared for email, and served publicly at `/i/<id>`, an unguessable id. Process tier: the team
 * is passed per call.
 */
export class EmailImages extends Context.Service<
  EmailImages,
  {
    readonly fromUpload: (
      teamId: TeamId,
      image: string,
    ) => Effect.Effect<HostedEmailImage, ImageUnreadable | ImageTooLarge | DatabaseUnavailable>
    readonly fromUrl: (
      teamId: TeamId,
      url: string,
    ) => Effect.Effect<HostedEmailImage, ImageUrlUnreachable | ImageUnreadable | ImageTooLarge | DatabaseUnavailable>
    /** The public address of an email image from its file key. */
    readonly urlOf: (fileKey: string) => string
    /** The image's bytes for the public route, or undefined when there's no such image. */
    readonly read: (id: string) => Effect.Effect<StoredFile | undefined, DatabaseUnavailable>
  }
>()("@parley/core/EmailImages") {
  static readonly layer = Layer.effect(
    EmailImages,
    Effect.gen(function* () {
      const db = yield* Database
      const files = yield* FileStore
      const base = (yield* PublicUrl.pipe(Effect.orDie)).replace(/\/$/, "")
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const urlOf = (fileKey: string) => `${base}/i/${idOfKey(fileKey)}`

      const store = (teamId: TeamId, file: EmailImageFile, sourceUrl: string | null) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const fileKey = `${teamId}/email-images/${id}.${file.extension}`
          yield* files.put(teamId, fileKey, { bytes: file.bytes, contentType: file.contentType })
          const [row] = yield* run(
            db.query((d) =>
              d
                .insert(schema.emailImages)
                .values({ id, teamId, fileKey, width: file.width, height: file.height, sourceUrl })
                .returning(),
            ),
          )
          return {
            id: id as EmailImageId,
            url: urlOf(fileKey),
            fileKey,
            width: file.width,
            height: file.height,
            createdAt: (row?.createdAt ?? new Date()).toISOString(),
          } satisfies HostedEmailImage
        })

      const fromUpload = (teamId: TeamId, image: string) =>
        Effect.flatMap(prepareEmailImage(bytesOf(image)), (file) => store(teamId, file, null)).pipe(
          Effect.withSpan("EmailImages.fromUpload"),
        )

      const fromUrl = (teamId: TeamId, url: string) =>
        Effect.gen(function* () {
          const fetched = yield* Effect.tryPromise({
            try: () => safeFetch(url, AbortSignal.timeout(IMPORT_DEADLINE_MS), IMPORT_MAX_BYTES),
            catch: () => new ImageUrlUnreachable({ status: null }),
          })
          if (!fetched?.type.startsWith("image/")) return yield* new ImageUrlUnreachable({ status: null })
          const file = yield* prepareEmailImage(fetched.bytes)
          return yield* store(teamId, file, url)
        }).pipe(Effect.withSpan("EmailImages.fromUrl"))

      const read = (id: string) =>
        IMAGE_ID.test(id)
          ? Effect.gen(function* () {
              const [row] = yield* run(
                db.query((d) =>
                  d
                    .select({ fileKey: schema.emailImages.fileKey })
                    .from(schema.emailImages)
                    .where(eq(schema.emailImages.id, id)),
                ),
              )
              return row ? yield* files.get(row.fileKey) : undefined
            })
          : Effect.succeed(undefined)

      return { fromUpload, fromUrl, urlOf, read }
    }),
  )
}
