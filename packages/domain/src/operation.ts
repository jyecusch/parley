import { Schema } from "effect"
import type { Permission } from "./access.ts"
import { MembershipErrors, PermissionErrors } from "./errors/access.ts"
import { AuthenticationErrors } from "./errors/authentication.ts"
import { InfrastructureErrors } from "./errors/infrastructure.ts"
import { InputRejected } from "./errors/input.ts"

type ErrorClass = Schema.Top & { readonly identifier: string }

/** Errors every operation can produce, from authentication, input and infrastructure. */
const BaseErrors = [...AuthenticationErrors, InputRejected, ...InfrastructureErrors] as const
/** Errors every team-scoped operation adds, from the membership and permission proofs. */
const TeamErrors = [...MembershipErrors, ...PermissionErrors] as const

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

/**
 * One action a principal can take. Defined once here, browser-safe, and every entrypoint
 * (HTTP API, MCP, web) is derived from it (D16).
 */
export interface Operation<
  Name extends string = string,
  Input extends Schema.Struct<Schema.Struct.Fields> = Schema.Struct<Schema.Struct.Fields>,
  Output extends Schema.Top = Schema.Top,
  Errors extends ReadonlyArray<ErrorClass> = ReadonlyArray<ErrorClass>,
> {
  /** Dotted, such as "contacts.update". MCP tools use it with "_" for ".". */
  readonly name: Name
  /** Read by agents (MCP tool description, OpenAPI). Say what it does and when to use it. */
  readonly description: string
  readonly input: Input
  readonly output: Output
  /** Every error class the operation can produce, as a closed tuple. */
  readonly errors: Errors
  readonly error: Schema.Union<Errors>
  /** Path parameters are named `:field` and taken from the input. */
  readonly http: { readonly method: HttpMethod; readonly path: `/${string}` }
  readonly hints: { readonly readOnly: boolean; readonly destructive: boolean; readonly idempotent: boolean }
  /** The permissions the operation's proofs require. Documentation for agents; enforcement lives in proofs. */
  readonly permissions: ReadonlyArray<Permission>
}

export type OperationError<Op extends Operation> = Op["error"]["Type"]
export type OperationInput<Op extends Operation> = Op["input"]["Type"]
export type OperationOutput<Op extends Operation> = Op["output"]["Type"]

const define = <
  const Name extends string,
  Input extends Schema.Struct<Schema.Struct.Fields>,
  Output extends Schema.Top,
  const Errors extends ReadonlyArray<ErrorClass>,
>(spec: {
  readonly name: Name
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly errors: Errors
  readonly http: Operation["http"]
  readonly hints: Operation["hints"]
  readonly permissions: ReadonlyArray<Permission>
}): Operation<Name, Input, Output, Errors> => ({ ...spec, error: Schema.Union(spec.errors) })

/** An operation that isn't scoped to a team, such as listing the principal's teams. */
export const defineOperation = <
  const Name extends string,
  Input extends Schema.Struct<Schema.Struct.Fields>,
  Output extends Schema.Top,
  const Errors extends ReadonlyArray<ErrorClass>,
>(spec: {
  readonly name: Name
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly errors: Errors
  readonly http: Operation["http"]
  readonly hints: Operation["hints"]
}) => define({ ...spec, permissions: [], errors: [...BaseErrors, ...spec.errors] as const })

/** An operation on one team's data. Adds the membership and permission errors. */
export const defineTeamOperation = <
  const Name extends string,
  Input extends Schema.Struct<Schema.Struct.Fields>,
  Output extends Schema.Top,
  const Errors extends ReadonlyArray<ErrorClass>,
>(spec: {
  readonly name: Name
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly errors: Errors
  readonly http: Operation["http"]
  readonly hints: Operation["hints"]
  readonly permissions: ReadonlyArray<Permission>
}) => define({ ...spec, errors: [...BaseErrors, ...TeamErrors, ...spec.errors] as const })
