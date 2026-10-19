// Type-checked, never run. Each line is a mistake the types must reject.
import { Schema } from "effect"
import { type DisplayName, type EchoedInput, type UserText, userText } from "../src/index.ts"

declare const plain: string
declare const team: DisplayName
declare const echoed: EchoedInput
declare const count: number
const ContactId = Schema.String.pipe(Schema.brand("ContactId"))
declare const contactId: typeof ContactId.Type

// Allowed: fixed words, numbers, DisplayName, EchoedInput, UserText.
export const ok: UserText = userText`${team} has ${count} ${count === 1 ? "contact" : "contacts"}, including ${echoed}.`

// @ts-expect-error a plain string could be foreign text
userText`Failed: ${plain}`
// @ts-expect-error an id is not a name the reader sees
userText`Contact ${contactId} not found`
// @ts-expect-error a UserText cannot be minted by assertion-free assignment from string
export const forged: UserText = plain
