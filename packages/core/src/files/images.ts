import { ImageTooLarge, ImageUnreadable } from "@parley/domain"
import { Effect } from "effect"
import sharp from "sharp"

const LIMIT_MEGABYTES = 10

/** Base64 or a data: URL, as bytes. */
export const bytesOf = (image: string): Uint8Array => {
  const base64 = image.startsWith("data:") ? image.slice(image.indexOf(",") + 1) : image
  return new Uint8Array(Buffer.from(base64, "base64"))
}

/**
 * An image as Parley stores it (D76): cropped square, 256px, re-encoded as WebP with metadata
 * stripped. Never served as uploaded.
 */
export const normalizeImage = (bytes: Uint8Array): Effect.Effect<Uint8Array, ImageUnreadable | ImageTooLarge> =>
  bytes.byteLength > LIMIT_MEGABYTES * 1024 * 1024
    ? Effect.fail(new ImageTooLarge({ limitMegabytes: LIMIT_MEGABYTES }))
    : Effect.tryPromise({
        try: async () =>
          new Uint8Array(
            await sharp(bytes, { limitInputPixels: 40_000_000, animated: false })
              .rotate()
              .resize(256, 256, { fit: "cover" })
              .webp({ quality: 85 })
              .toBuffer(),
          ),
        catch: () => new ImageUnreadable(),
      })
