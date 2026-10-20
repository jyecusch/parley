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

/** The widest an email image is kept: twice a 600px email column, for sharp screens. */
const EMAIL_IMAGE_MAX_WIDTH = 1200

export interface EmailImageFile {
  readonly bytes: Uint8Array
  readonly contentType: "image/png" | "image/jpeg"
  readonly extension: "png" | "jpg"
  readonly width: number
  readonly height: number
}

/**
 * An image as Parley hosts it for email (D120): rotated upright, at most 1200px wide (never
 * enlarged), metadata stripped. PNG when it has transparency, else JPEG: WebP isn't safe in email,
 * since Outlook doesn't show it. Animated GIFs keep only their first frame.
 */
export const prepareEmailImage = (bytes: Uint8Array): Effect.Effect<EmailImageFile, ImageUnreadable | ImageTooLarge> =>
  bytes.byteLength > LIMIT_MEGABYTES * 1024 * 1024
    ? Effect.fail(new ImageTooLarge({ limitMegabytes: LIMIT_MEGABYTES }))
    : Effect.tryPromise({
        try: async () => {
          const source = sharp(bytes, { limitInputPixels: 40_000_000, animated: false })
          const { hasAlpha } = await source.metadata()
          const resized = source.rotate().resize({ width: EMAIL_IMAGE_MAX_WIDTH, withoutEnlargement: true })
          const encoded = hasAlpha ? resized.png({ compressionLevel: 9 }) : resized.jpeg({ quality: 82, mozjpeg: true })
          const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
          return {
            bytes: new Uint8Array(data),
            contentType: hasAlpha ? ("image/png" as const) : ("image/jpeg" as const),
            extension: hasAlpha ? ("png" as const) : ("jpg" as const),
            width: info.width,
            height: info.height,
          }
        },
        catch: () => new ImageUnreadable(),
      })
