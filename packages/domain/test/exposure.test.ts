import { describe, expect, expectTypeOf, it } from "vitest"
import {
  type CheckedExposureManifest,
  type ExposureManifest,
  type IncludedOperationName,
  includedOperationNames,
} from "../src/exposure.ts"

type FixtureRegistry = {
  direct: { input: { Type: { directId: string; optionalId?: string; undefinedId: string | undefined; data: object } } }
  via: { input: { Type: { viaId: string } } }
  internal: { input: { Type: object } }
}

const fixture = {
  direct: { http: { kind: "included", method: "GET", path: "/direct/:directId" }, mcp: { kind: "included" } },
  via: {
    http: { kind: "included", method: "POST", path: "/via/:viaId" },
    mcp: { kind: "analogous", operation: "direct", reason: "The direct tool accepts the same inputs." },
  },
  internal: {
    http: { kind: "excluded", reason: "Only the background worker invokes this operation." },
    mcp: { kind: "excluded", reason: "Only the background worker invokes this operation." },
  },
} as const satisfies ExposureManifest<"direct" | "via" | "internal">
fixture satisfies CheckedExposureManifest<typeof fixture, FixtureRegistry>

describe("explicit operation exposure", () => {
  it("publishes only direct inclusions for each entrypoint", () => {
    expect(includedOperationNames(fixture, "http")).toEqual(["direct", "via"])
    expect(includedOperationNames(fixture, "mcp")).toEqual(["direct"])
  })

  it("preserves either entrypoint's included names when the entrypoint is chosen at runtime", () => {
    const select = (entrypoint: "http" | "mcp") => includedOperationNames(fixture, entrypoint)
    expectTypeOf(select).returns.toEqualTypeOf<ReadonlyArray<"direct" | "via">>()
    expect(select("http")).toEqual(["direct", "via"])
    expect(select("mcp")).toEqual(["direct"])
  })
  it("keeps possible inclusions when a manifest is widened", () => {
    const select = (manifest: ExposureManifest<keyof typeof fixture>) => includedOperationNames(manifest, "http")
    expectTypeOf(select).returns.toEqualTypeOf<ReadonlyArray<"direct" | "via" | "internal">>()
    expect(select(fixture)).toEqual(["direct", "via"])
  })
})

// These fixtures must fail type-checking even though every branch is explicit at runtime.
const compileChecks = () => {
  // @ts-expect-error Every registered operation needs a decision.
  const missing: ExposureManifest<"direct" | "new"> = { direct: fixture.direct }
  // @ts-expect-error Both entrypoints need a decision.
  const missingEntrypoint: ExposureManifest<"direct"> = { direct: { http: fixture.direct.http } }
  // @ts-expect-error Unknown operation keys are rejected.
  const unknown: ExposureManifest<"direct"> = { direct: fixture.direct, unknown: fixture.direct }
  // @ts-expect-error Exclusion requires a reason.
  const unexplained: ExposureManifest<"direct"> = { direct: { http: { kind: "excluded" }, mcp: { kind: "included" } } }
  const unknownTarget: ExposureManifest<"direct"> = {
    // @ts-expect-error An analogous operation must name a registered operation.
    direct: { http: fixture.direct.http, mcp: { kind: "analogous", operation: "missing", reason: "Equivalent." } },
  }
  const emptyReason = { direct: { http: { kind: "excluded", reason: "" }, mcp: { kind: "included" } } } as const
  // @ts-expect-error An empty reason is not an intentional exclusion.
  emptyReason satisfies CheckedExposureManifest<typeof emptyReason, FixtureRegistry>
  const excludedTarget = {
    ...fixture,
    via: { ...fixture.via, mcp: { ...fixture.via.mcp, operation: "internal" } },
  } as const
  // @ts-expect-error An analogous operation must point to a directly included MCP operation.
  excludedTarget satisfies CheckedExposureManifest<typeof excludedTarget, FixtureRegistry>
  const selfTarget = { ...fixture, via: { ...fixture.via, mcp: { ...fixture.via.mcp, operation: "via" } } } as const
  // @ts-expect-error A self-reference does not provide an agent entrypoint.
  selfTarget satisfies CheckedExposureManifest<typeof selfTarget, FixtureRegistry>
  const cycle = {
    ...fixture,
    direct: { ...fixture.direct, mcp: { kind: "analogous", operation: "via", reason: "Equivalent." } },
  } as const
  // @ts-expect-error Cycles and chains cannot replace a directly published tool.
  cycle satisfies CheckedExposureManifest<typeof cycle, FixtureRegistry>
  const emptyAnalogousReason = { ...fixture, via: { ...fixture.via, mcp: { ...fixture.via.mcp, reason: "" } } } as const
  // @ts-expect-error An analogous operation must explain the relationship.
  emptyAnalogousReason satisfies CheckedExposureManifest<typeof emptyAnalogousReason, FixtureRegistry>
  const blankReason = {
    ...fixture,
    internal: { ...fixture.internal, http: { kind: "excluded", reason: " \t\n\r " } },
  } as const
  // @ts-expect-error Whitespace is not an intentional exclusion.
  blankReason satisfies CheckedExposureManifest<typeof blankReason, FixtureRegistry>
  const broadReason = {
    ...fixture,
    internal: { ...fixture.internal, mcp: { kind: "excluded", reason: "Worker only." as string } },
  } as const
  // @ts-expect-error A plain string does not prove that a reason is present.
  broadReason satisfies CheckedExposureManifest<typeof broadReason, FixtureRegistry>
  const blankAnalogousReason = {
    ...fixture,
    via: { ...fixture.via, mcp: { ...fixture.via.mcp, reason: " " } },
  } as const
  // @ts-expect-error An analogous operation also needs a nonblank literal reason.
  blankAnalogousReason satisfies CheckedExposureManifest<typeof blankAnalogousReason, FixtureRegistry>
  const wrongParameter = {
    ...fixture,
    direct: { ...fixture.direct, http: { ...fixture.direct.http, path: "/direct/:directID" } },
  } as const
  // @ts-expect-error Path parameters must be keys of this operation's input.
  wrongParameter satisfies CheckedExposureManifest<typeof wrongParameter, FixtureRegistry>
  const otherInputParameter = {
    ...fixture,
    direct: { ...fixture.direct, http: { ...fixture.direct.http, path: "/direct/:viaId" } },
  } as const
  // @ts-expect-error A field of another operation is not a valid path parameter.
  otherInputParameter satisfies CheckedExposureManifest<typeof otherInputParameter, FixtureRegistry>
  const optionalParameter = {
    ...fixture,
    direct: { ...fixture.direct, http: { ...fixture.direct.http, path: "/direct/:optionalId" } },
  } as const
  // @ts-expect-error A valid operation input may omit an optional field, so it cannot be a required path parameter.
  optionalParameter satisfies CheckedExposureManifest<typeof optionalParameter, FixtureRegistry>
  const undefinedParameter = {
    ...fixture,
    direct: { ...fixture.direct, http: { ...fixture.direct.http, path: "/direct/:undefinedId" } },
  } as const
  // @ts-expect-error A path parameter must have a supplied scalar value.
  undefinedParameter satisfies CheckedExposureManifest<typeof undefinedParameter, FixtureRegistry>
  const structuredParameter = {
    ...fixture,
    direct: { ...fixture.direct, http: { ...fixture.direct.http, path: "/direct/:data" } },
  } as const
  // @ts-expect-error Structured input belongs in query or payload fields, not path parameters.
  structuredParameter satisfies CheckedExposureManifest<typeof structuredParameter, FixtureRegistry>
  const maybePublished = {
    ...fixture,
    direct: {
      ...fixture.direct,
      mcp: fixture.direct.mcp as
        | { readonly kind: "included" }
        | { readonly kind: "excluded"; readonly reason: "Worker only." },
    },
  } as const
  // @ts-expect-error An analogous target must be definitely published, not merely possibly included.
  maybePublished satisfies CheckedExposureManifest<typeof maybePublished, FixtureRegistry>
  // @ts-expect-error Excluded operations cannot be called through a typed HTTP client.
  const excludedHttp: IncludedOperationName<typeof fixture, "http"> = "internal"
  // @ts-expect-error An analogous operation is not a directly callable tool.
  const analogousMcp: IncludedOperationName<typeof fixture, "mcp"> = "via"
  return { missing, missingEntrypoint, unknown, unexplained, unknownTarget, excludedHttp, analogousMcp }
}
void compileChecks
