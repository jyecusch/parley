import type { Trim } from "effect/String"

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

export interface HttpRoute {
  readonly kind: "included"
  readonly method: HttpMethod
  /** HttpRoute.path names input fields as `:field` path parameters. */
  readonly path: `/${string}`
}

interface ExcludedExposure {
  readonly kind: "excluded"
  readonly reason: string
}

export interface OperationExposure<Name extends string = string> {
  readonly http: HttpRoute | ExcludedExposure
  readonly mcp:
    | { readonly kind: "included" }
    | { readonly kind: "analogous"; readonly operation: Name; readonly reason: string }
    | ExcludedExposure
}

export type ExposureManifest<Name extends string> = { readonly [N in Name]: OperationExposure<Name> }

type Entrypoint = "http" | "mcp"

export type IncludedOperationName<
  Manifest extends ExposureManifest<string>,
  Entry extends Entrypoint,
> = Entry extends Entrypoint
  ? {
      [Name in keyof Manifest & string]: Manifest[Name][Entry] extends { readonly kind: "included" } ? Name : never
    }[keyof Manifest & string]
  : never

type PossiblyIncludedOperationName<
  Manifest extends ExposureManifest<string>,
  Entry extends Entrypoint,
> = Entry extends Entrypoint
  ? {
      [Name in keyof Manifest & string]: "included" extends Manifest[Name][Entry]["kind"] ? Name : never
    }[keyof Manifest & string]
  : never

type WithReason<Policy> = Policy extends { readonly reason: infer Reason extends string }
  ? string extends Reason
    ? never
    : "" extends Trim<Reason>
      ? never
      : Policy
  : Policy

type CheckedMcp<Policy, Direct extends string> = Policy extends {
  readonly kind: "analogous"
  readonly operation: infer Target
}
  ? Target extends Direct
    ? WithReason<Policy>
    : never
  : WithReason<Policy>

type PathParameters<Path extends string> = Path extends `${infer Segment}/${infer Rest}`
  ? PathParameters<Segment> | PathParameters<Rest>
  : Path extends `:${infer Name}`
    ? Name
    : never

type PathInputKey<Input> = {
  [Key in keyof Input]-?: Input[Key] extends string | number | boolean ? Key : never
}[keyof Input]

type CheckedHttp<Policy, Fields extends PropertyKey> = Policy extends {
  readonly kind: "included"
  readonly path: infer Path extends string
}
  ? Exclude<PathParameters<Path>, Fields> extends never
    ? Policy
    : never
  : WithReason<Policy>

/** CheckedExposureManifest requires literal reasons, required scalar path parameters, and directly published MCP targets. */
export type CheckedExposureManifest<
  Manifest extends ExposureManifest<string>,
  Registry extends { readonly [Name in keyof Manifest]: { readonly input: { readonly Type: object } } },
> = {
  readonly [Name in keyof Manifest]: {
    readonly http: CheckedHttp<Manifest[Name]["http"], PathInputKey<Registry[Name]["input"]["Type"]>>
    readonly mcp: CheckedMcp<Manifest[Name]["mcp"], IncludedOperationName<Manifest, "mcp">>
  }
}

/** includedOperationNames selects only explicit inclusions; exclusions and analogous operations do not register endpoints. */
export const includedOperationNames = <const Manifest extends ExposureManifest<string>, Entry extends Entrypoint>(
  manifest: Manifest,
  entrypoint: Entry,
): ReadonlyArray<PossiblyIncludedOperationName<Manifest, Entry>> =>
  Object.entries(manifest).flatMap(([name, exposure]) =>
    exposure[entrypoint].kind === "included" ? [name] : [],
  ) as Array<PossiblyIncludedOperationName<Manifest, Entry>>
