import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import sharp from "sharp"
import { CoreLive, FileStore, readFile, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const png = () =>
  promise(() =>
    sharp({ create: { width: 600, height: 400, channels: 3, background: "#ffb000" } })
      .png()
      .toBuffer(),
  ).pipe(Effect.map((buffer) => `data:image/png;base64,${buffer.toString("base64")}`))

const promise = <A>(thunk: () => Promise<A>) => Effect.tryPromise(thunk).pipe(Effect.orDie)

const keyOf = (url: string | null) => (url ?? "").replace("/api/files/", "")

describe("avatars and logos", () => {
  it.effect("stores an avatar normalized, serves it to the team only, and removes it", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const contact = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ada" })
      const image = yield* png()
      const withAvatar = yield* run["contacts.setAvatar"](f.jane, {
        teamId: f.acme,
        contactId: contact.id,
        image,
      })
      expect(withAvatar.avatarUrl).toMatch(new RegExp(`^/api/files/${f.acme}/avatars/`))

      const file = yield* readFile(f.jane, keyOf(withAvatar.avatarUrl))
      expect(file.contentType).toBe("image/webp")
      const meta = yield* promise(() => sharp(file.bytes).metadata())
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256])

      // A key that climbs out of its team is refused before any lookup.
      const key = keyOf(withAvatar.avatarUrl)
      for (const forged of [`${f.acme}/../${key}`, `${f.acme}/avatars/../../${key}`, `${f.acme}%2F..%2F${key}`]) {
        expect((yield* readFile(f.jane, forged).pipe(Effect.flip))._tag).toBe("FileNotFound")
      }

      // Someone outside the team can't tell the file exists.
      const hidden = yield* readFile(f.bob, keyOf(withAvatar.avatarUrl)).pipe(Effect.flip)
      expect(hidden._tag).toBe("FileNotFound")

      // A read-only key can't change it, and an unreadable image is refused.
      const denied = yield* run["contacts.setAvatar"](f.janeReadOnlyKey, {
        teamId: f.acme,
        contactId: contact.id,
        image,
      }).pipe(Effect.flip)
      expect(denied._tag).toBe("ApiKeyScopeExcludes")
      const garbage = yield* run["contacts.setAvatar"](f.jane, {
        teamId: f.acme,
        contactId: contact.id,
        image: Buffer.from("not an image").toString("base64"),
      }).pipe(Effect.flip)
      expect(garbage._tag).toBe("ImageUnreadable")

      const removed = yield* run["contacts.removeAvatar"](f.jane, { teamId: f.acme, contactId: contact.id })
      expect(removed.avatarUrl).toBeNull()
      const files = yield* FileStore
      expect(yield* files.get(keyOf(withAvatar.avatarUrl))).toBeUndefined()
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("replaces a company logo, and keeps no old file behind", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const company = yield* run["companies.create"](f.jane, { teamId: f.acme, name: "Initech" })
      expect(company.logoUrl).toBeNull()
      const image = yield* png()
      const first = yield* run["companies.setLogo"](f.jane, { teamId: f.acme, companyId: company.id, image })
      const second = yield* run["companies.setLogo"](f.jane, { teamId: f.acme, companyId: company.id, image })
      expect(second.logoUrl).not.toBe(first.logoUrl)
      const files = yield* FileStore
      expect(yield* files.get(keyOf(first.logoUrl))).toBeUndefined()
      const removed = yield* run["companies.removeLogo"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(removed.logoUrl).toBeNull()
    }).pipe(Effect.provide(CoreLive)),
  )
})
