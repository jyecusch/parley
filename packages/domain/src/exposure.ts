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

export type IncludedOperationName<Manifest extends ExposureManifest<string>, Protocol extends Entrypoint> = {
  [Name in keyof Manifest & string]: Manifest[Name][Protocol] extends { readonly kind: "included" } ? Name : never
}[keyof Manifest & string]

type WithReason<Policy> = Policy extends { readonly reason: infer Reason extends string }
  ? Reason extends ""
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

/** CheckedExposureManifest rejects empty reasons and MCP analogues without a directly published target. */
export type CheckedExposureManifest<Manifest extends ExposureManifest<string>> = {
  readonly [Name in keyof Manifest]: {
    readonly http: WithReason<Manifest[Name]["http"]>
    readonly mcp: CheckedMcp<Manifest[Name]["mcp"], IncludedOperationName<Manifest, "mcp">>
  }
}

/** includedOperationNames selects only explicit inclusions; exclusions and analogues do not register endpoints. */
export const includedOperationNames = <const Manifest extends ExposureManifest<string>, Protocol extends Entrypoint>(
  manifest: Manifest,
  protocol: Protocol,
): ReadonlyArray<IncludedOperationName<Manifest, Protocol>> =>
  Object.keys(manifest).filter((name) => manifest[name]?.[protocol].kind === "included") as Array<
    IncludedOperationName<Manifest, Protocol>
  >
