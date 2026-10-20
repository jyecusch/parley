import { describe, expect, it } from "@effect/vitest"
import { operations } from "@parley/domain"

describe("tool hints", () => {
  // MCP clients may run a tool without asking when it says it isn't destructive, so anything that
  // overwrites, removes, imports over, revokes, cancels or sends must say it is.
  it("marks every operation that overwrites or removes data as destructive", () => {
    const risky = /\.(update\w*|delete|remove\w*|import|revoke|cancel|send|set\w+)$/
    // Names that match but only add something: copying an image into Parley overwrites nothing.
    const onlyAdds = new Set(["emailImages.import"])
    const unmarked = Object.values(operations)
      .filter(
        (operation) => risky.test(operation.name) && !onlyAdds.has(operation.name) && !operation.hints.destructive,
      )
      .map((operation) => operation.name)
    expect(unmarked).toEqual([])
  })
})
