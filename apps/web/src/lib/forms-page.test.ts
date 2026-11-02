import { afterEach, describe, expect, it, vi } from "vitest"
import { embedContextOf } from "./forms-page.ts"

const appearance = JSON.stringify({ hideFinePrint: true })
const search = `?${new URLSearchParams({ appearance, gclid: "example-click", utm_source: "example-site" })}`

afterEach(() => vi.unstubAllGlobals())

describe("form appearance overrides", () => {
  it("ignores appearance and click ids without a browser context", () => {
    vi.stubGlobal("window", undefined)
    expect(embedContextOf(search)).toMatchObject({
      appearance: null,
      clickIds: {},
      utm: { utm_source: "example-site" },
    })
  })

  it("ignores appearance and click ids in a top-level hosted page", () => {
    const page = {
      get parent(): unknown {
        return page
      },
    }
    vi.stubGlobal("window", page)
    expect(embedContextOf(search)).toMatchObject({
      appearance: null,
      clickIds: {},
      utm: { utm_source: "example-site" },
    })
  })

  it("keeps appearance and click ids inside an embedded frame", () => {
    vi.stubGlobal("window", { parent: {} })
    expect(embedContextOf(search)).toMatchObject({
      appearance,
      clickIds: { gclid: "example-click" },
      utm: { utm_source: "example-site" },
    })
  })
})
