import { describe, expect, it } from "vitest"
import {
  type CheckedExposureManifest,
  type ExposureManifest,
  type IncludedOperationName,
  includedOperationNames,
} from "../src/exposure.ts"
import { httpOperationNames, mcpOperationNames, operationExposures } from "../src/operations/exposure.ts"
import { operations } from "../src/operations/index.ts"

const fixture = {
  direct: { http: { kind: "included", method: "GET", path: "/direct" }, mcp: { kind: "included" } },
  via: {
    http: { kind: "included", method: "POST", path: "/via" },
    mcp: { kind: "analogous", operation: "direct", reason: "The direct tool accepts the same inputs." },
  },
  internal: {
    http: { kind: "excluded", reason: "Only the background worker invokes this operation." },
    mcp: { kind: "excluded", reason: "Only the background worker invokes this operation." },
  },
} as const satisfies ExposureManifest<"direct" | "via" | "internal">
fixture satisfies CheckedExposureManifest<typeof fixture>

describe("explicit operation exposure", () => {
  it("publishes only direct inclusions for each protocol", () => {
    expect(includedOperationNames(fixture, "http")).toEqual(["direct", "via"])
    expect(includedOperationNames(fixture, "mcp")).toEqual(["direct"])
  })

  it("accounts for every registered operation and preserves current parity", () => {
    const names = Object.keys(operations).sort()
    expect(Object.keys(operationExposures).sort()).toEqual(names)
    expect([...httpOperationNames].sort()).toEqual(names)
    expect([...mcpOperationNames].sort()).toEqual(names)
  })
})

// These fixtures must fail type-checking even though every branch is explicit at runtime.
const compileChecks = () => {
  // @ts-expect-error Every registered operation needs a decision.
  const missing: ExposureManifest<"direct" | "new"> = { direct: fixture.direct }
  // @ts-expect-error Both protocols need a decision.
  const missingProtocol: ExposureManifest<"direct"> = { direct: { http: fixture.direct.http } }
  // @ts-expect-error Unknown operation keys are rejected.
  const unknown: ExposureManifest<"direct"> = { direct: fixture.direct, unknown: fixture.direct }
  // @ts-expect-error Exclusion requires a reason.
  const unexplained: ExposureManifest<"direct"> = { direct: { http: { kind: "excluded" }, mcp: { kind: "included" } } }
  const unknownTarget: ExposureManifest<"direct"> = {
    // @ts-expect-error An analogue must name a registered operation.
    direct: { http: fixture.direct.http, mcp: { kind: "analogous", operation: "missing", reason: "Equivalent." } },
  }
  const emptyReason = { direct: { http: { kind: "excluded", reason: "" }, mcp: { kind: "included" } } } as const
  // @ts-expect-error An empty reason is not an intentional exclusion.
  emptyReason satisfies CheckedExposureManifest<typeof emptyReason>
  const excludedTarget = {
    ...fixture,
    via: { ...fixture.via, mcp: { ...fixture.via.mcp, operation: "internal" } },
  } as const
  // @ts-expect-error An analogue must point to a directly included MCP operation.
  excludedTarget satisfies CheckedExposureManifest<typeof excludedTarget>
  const selfTarget = { ...fixture, via: { ...fixture.via, mcp: { ...fixture.via.mcp, operation: "via" } } } as const
  // @ts-expect-error A self-reference does not provide an agent interface.
  selfTarget satisfies CheckedExposureManifest<typeof selfTarget>
  const cycle = {
    ...fixture,
    direct: { ...fixture.direct, mcp: { kind: "analogous", operation: "via", reason: "Equivalent." } },
  } as const
  // @ts-expect-error Cycles and chains cannot replace a directly published tool.
  cycle satisfies CheckedExposureManifest<typeof cycle>
  const emptyAnalogue = { ...fixture, via: { ...fixture.via, mcp: { ...fixture.via.mcp, reason: "" } } } as const
  // @ts-expect-error An analogue must explain the relationship.
  emptyAnalogue satisfies CheckedExposureManifest<typeof emptyAnalogue>
  // @ts-expect-error Excluded operations cannot be called through a typed HTTP client.
  const excludedHttp: IncludedOperationName<typeof fixture, "http"> = "internal"
  // @ts-expect-error An analogous operation is not a directly callable tool.
  const analogousMcp: IncludedOperationName<typeof fixture, "mcp"> = "via"
  return { missing, missingProtocol, unknown, unexplained, unknownTarget, excludedHttp, analogousMcp }
}
void compileChecks
