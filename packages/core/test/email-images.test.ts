import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import sharp from "sharp"
import { CoreLive, EmailImages, implementations as run } from "../src/index.ts"
import { isFileKey } from "../src/services/file-store.ts"
import { Fixture } from "./fixture.ts"

const promise = <A>(thunk: () => Promise<A>) => Effect.tryPromise(thunk).pipe(Effect.orDie)

const image = (width: number, height: number, alpha: boolean) =>
  promise(() =>
    sharp({
      create: {
        width,
        height,
        channels: alpha ? 4 : 3,
        background: alpha ? { r: 47, g: 91, b: 234, alpha: 0.5 } : "#2f5bea",
      },
    })
      .png()
      .toBuffer(),
  ).pipe(Effect.map((buffer) => `data:image/png;base64,${buffer.toString("base64")}`))

const idOf = (url: string) => url.slice(url.lastIndexOf("/i/") + 3)

describe("email images", () => {
  it.effect("hosts uploads publicly, resized for email, as JPEG or PNG when transparent", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const images = yield* EmailImages

      const photo = yield* run["emailImages.upload"](f.jane, { teamId: f.acme, image: yield* image(2400, 1200, false) })
      expect(photo.url).toMatch(/\/i\/[0-9a-f-]{36}$/)
      expect([photo.width, photo.height]).toEqual([1200, 600])
      const stored = yield* images.read(idOf(photo.url))
      expect(stored?.contentType).toBe("image/jpeg")
      expect((yield* promise(() => sharp(stored?.bytes ?? new Uint8Array()).metadata())).format).toBe("jpeg")

      const logo = yield* run["emailImages.upload"](f.jane, { teamId: f.acme, image: yield* image(300, 100, true) })
      // Small images aren't enlarged, and transparency is kept.
      expect([logo.width, logo.height]).toEqual([300, 100])
      expect((yield* images.read(idOf(logo.url)))?.contentType).toBe("image/png")

      // Unknown and malformed ids read as nothing.
      expect(yield* images.read(crypto.randomUUID())).toBeUndefined()
      expect(yield* images.read("../../etc/passwd")).toBeUndefined()

      // Someone who can't write email can't upload.
      const denied = yield* run["emailImages.upload"](f.janeReadOnlyKey, {
        teamId: f.acme,
        image: yield* image(10, 10, false),
      }).pipe(Effect.flip)
      expect(denied._tag).toBe("ApiKeyScopeExcludes")
      const garbage = yield* run["emailImages.upload"](f.jane, {
        teamId: f.acme,
        image: Buffer.from("not an image").toString("base64"),
      }).pipe(Effect.flip)
      expect(garbage._tag).toBe("ImageUnreadable")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("only imports from public https addresses", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      for (const url of [
        "http://example.com/a.png",
        "https://127.0.0.1/a.png",
        "https://localhost/a.png",
        "https://[::1]/a.png",
        "https://169.254.169.254/latest/meta-data",
      ]) {
        const refused = yield* run["emailImages.import"](f.jane, { teamId: f.acme, url }).pipe(Effect.flip)
        expect(refused._tag, url).toBe("ImageUrlUnreachable")
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it("accepts only the file keys Parley makes", () => {
    expect(isFileKey("team_1/email-images/0b6c2f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg")).toBe(true)
    expect(isFileKey("team_1/email-images/0b6c2f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png")).toBe(true)
    expect(isFileKey("team_1/email-images/x.webp")).toBe(false)
    expect(isFileKey("team_1/email-images/../avatars/x.jpg")).toBe(false)
    expect(isFileKey("team_1/avatars/x-1.webp")).toBe(true)
    expect(isFileKey("team_1/avatars/x-1.jpg")).toBe(false)
  })
})
