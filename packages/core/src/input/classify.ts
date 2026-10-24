import { type FieldProblem, type FieldProblemKind, InputRejected } from "@parley/domain"
import { FieldLabel, type UserText, userText } from "@parley/errors"
import type { Schema, SchemaIssue } from "effect"

/** Words for our own schema keys when a field has no title annotation. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  address: "Email",
  number: "Phone",
  label: "Phone label",
  teamId: "Team",
  contactId: "Contact",
}

const labelFor = (title: string | undefined, path: ReadonlyArray<PropertyKey>): FieldLabel => {
  if (title) return FieldLabel.fromSchemaTitle(title)
  const key = [...path].reverse().find((segment): segment is string => typeof segment === "string")
  if (!key) return FieldLabel.fromSchemaTitle("This field")
  const known = KEY_LABELS[key]
  if (known) return FieldLabel.fromSchemaTitle(known)
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  return FieldLabel.fromSchemaTitle(words.charAt(0).toUpperCase() + words.slice(1))
}

const kindOfFilter = (id: string | undefined): FieldProblemKind => {
  switch (id) {
    case "effect/schema/isMinLength":
    case "effect/schema/isNonEmpty":
      return "too-short"
    case "effect/schema/isMaxLength":
      return "too-long"
    case "effect/schema/isBetween":
    case "effect/schema/isGreaterThanOrEqualTo":
    case "effect/schema/isLessThanOrEqualTo":
      return "out-of-range"
    default:
      return "invalid-format"
  }
}

const messageFor = (kind: FieldProblemKind, label: FieldLabel): UserText => {
  switch (kind) {
    case "missing":
      return userText`${label} is required.`
    case "not-allowed":
      return userText`${label} can't be set here.`
    case "wrong-type":
      return userText`${label} isn't the right kind of value.`
    case "too-short":
      return userText`${label} is too short.`
    case "too-long":
      return userText`${label} is too long.`
    case "out-of-range":
      return userText`${label} is out of range.`
    case "conflict":
      return userText`${label} conflicts with another value.`
    case "invalid-format":
      return userText`${label} isn't in a valid format.`
  }
}

type Annotated = { readonly annotations?: { readonly title?: unknown } | undefined }
const titleOf = (value: unknown): string | undefined => {
  const title = (value as Annotated | undefined)?.annotations?.title
  return typeof title === "string" ? title : undefined
}

/**
 * Turns a schema decode failure into InputRejected: every field problem at once, in our words,
 * never echoing the rejected value or Schema's own message (D26).
 */
export const classifyDecodeError = (error: Schema.SchemaError): InputRejected => {
  const problems: Array<FieldProblem> = []
  const push = (kind: FieldProblemKind, path: ReadonlyArray<PropertyKey>, title: string | undefined) => {
    const field = path.map(String).join(".") || "input"
    if (problems.some((problem) => problem.field === field)) return
    // The input as a whole isn't an object: no body, or JSON that isn't one.
    const userMessage =
      path.length === 0 && kind === "wrong-type"
        ? userText`The input should be a JSON object of its fields, such as {"firstName": "Ada"}.`
        : messageFor(kind, labelFor(title, path))
    problems.push({ field, problem: kind, userMessage })
  }
  const walk = (issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>, title: string | undefined): void => {
    switch (issue._tag) {
      case "Pointer":
        walk(issue.issue, [...path, ...issue.path], undefined)
        return
      case "Composite":
        for (const inner of issue.issues) walk(inner, path, title ?? titleOf(issue.ast))
        return
      case "Encoding":
        walk(issue.issue, path, title ?? titleOf(issue.ast))
        return
      case "Filter": {
        const representation = issue.filter.annotations?.representation as { readonly id?: string } | undefined
        push(kindOfFilter(representation?.id), path, title ?? titleOf(issue.filter))
        return
      }
      case "MissingKey":
        push("missing", path, title)
        return
      case "UnexpectedKey":
        push("not-allowed", path, title)
        return
      case "AnyOf": {
        // An optional or nullable field fails as a union. Look inside the member that got
        // furthest, rather than reporting "wrong kind of value" for the whole field.
        const deeper = issue.issues.filter((inner) => inner._tag !== "InvalidType")
        if (deeper.length > 0) {
          for (const inner of deeper) walk(inner, path, title ?? titleOf(issue.ast))
          return
        }
        push("wrong-type", path, title ?? titleOf(issue.ast))
        return
      }
      case "InvalidType":
      case "OneOf":
        push("wrong-type", path, title ?? titleOf(issue.ast))
        return
      case "InvalidValue":
      case "Forbidden":
        push("invalid-format", path, title)
        return
    }
  }
  walk(error.issue, [], undefined)
  return new InputRejected({ problems })
}
