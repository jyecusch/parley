import { type DomainError, userText } from "@parley/errors"
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"

/** The upload isn't an image Parley can read (JPEG, PNG, WebP, GIF, AVIF or SVG). */
export class ImageUnreadable
  extends Schema.TaggedError<ImageUnreadable>()("ImageUnreadable", {})
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "image could not be decoded"
  }
  get userMessage() {
    return userText`Parley can't read this image. Use a JPEG, PNG, WebP or GIF.`
  }
}

/** The upload is over the size limit. */
export class ImageTooLarge
  extends Schema.TaggedError<ImageTooLarge>()("ImageTooLarge", { limitMegabytes: Schema.Number })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "image over the size limit"
  }
  get userMessage() {
    return userText`This image is too big. Use one under ${this.limitMegabytes} MB.`
  }
}

/** No file at that address, or it belongs to a team the principal isn't in. */
export class FileNotFound extends Schema.TaggedError<FileNotFound>()("FileNotFound", {}) implements DomainError {
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return "file not found"
  }
  get userMessage() {
    return userText`This file doesn't exist, or you don't have access to it.`
  }
}
