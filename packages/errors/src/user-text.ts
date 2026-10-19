import { Schema } from "effect"

const BRAND_KEY = "~effect/Brand"

/** Text written for users and agents, built only from our own words. */
const UserTextSchema = Schema.String.pipe(Schema.brand("UserText"))
export type UserText = typeof UserTextSchema.Type
export const UserText = { schema: UserTextSchema }

/**
 * A name the reader already sees in the app: a team, company, contact or user name.
 * Create it where the name is read from its record, never from a literal.
 */
const DisplayNameSchema = Schema.String.pipe(Schema.brand("DisplayName"))
export type DisplayName = typeof DisplayNameSchema.Type
export const DisplayName = {
  schema: DisplayNameSchema,
  fromRecord: (name: string): DisplayName => name as DisplayName,
}

const ECHO_LIMIT = 80

/** A value from the request being answered, such as the email someone just typed, capped in length. */
const EchoedInputSchema = Schema.String.pipe(Schema.brand("EchoedInput"))
export type EchoedInput = typeof EchoedInputSchema.Type
export const EchoedInput = {
  schema: EchoedInputSchema,
  fromRequest: (value: string): EchoedInput =>
    (value.length > ECHO_LIMIT ? `${value.slice(0, ECHO_LIMIT - 1)}…` : value) as EchoedInput,
}

/** A short id that finds the full log entry for a defect. Shown so people can quote it to an administrator. */
const ReferenceIdSchema = Schema.String.pipe(Schema.brand("ReferenceId"))
export type ReferenceId = typeof ReferenceIdSchema.Type
export const ReferenceId = {
  schema: ReferenceIdSchema,
  make: (): ReferenceId => {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    let id = ""
    for (const byte of bytes) id += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]
    return `${id.slice(0, 4)}-${id.slice(4)}` as ReferenceId
  },
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const FieldLabelSchema = Schema.String.pipe(Schema.brand("FieldLabel"))
export type FieldLabel = typeof FieldLabelSchema.Type
/** The label of an input field, taken from a title annotation we wrote on our own schema. */
export const FieldLabel = {
  schema: FieldLabelSchema,
  fromSchemaTitle: (title: string): FieldLabel => title as FieldLabel,
}

type Branded = { readonly [BRAND_KEY]: unknown }

/**
 * What a `userText` interpolation may be: fixed words (string literals), numbers,
 * and the five sanctioned brands. A plain `string` or any other brand is `never`.
 */
export type UserTextPart<T> = T extends UserText | DisplayName | EchoedInput | ReferenceId | FieldLabel | number
  ? T
  : T extends Branded
    ? never
    : T extends string
      ? string extends T
        ? never
        : T
      : never

/**
 * The only sanctioned way to make `UserText`.
 *
 * @example
 * userText`${team} has ${count} ${count === 1 ? "contact" : "contacts"} with that email.`
 */
export const userText = <const Parts extends ReadonlyArray<unknown>>(
  strings: TemplateStringsArray,
  ...parts: Parts & { readonly [K in keyof Parts]: UserTextPart<Parts[K]> }
): UserText => {
  let text = strings[0] ?? ""
  for (let index = 0; index < parts.length; index++) {
    text += String(parts[index]) + (strings[index + 1] ?? "")
  }
  return text as UserText
}
