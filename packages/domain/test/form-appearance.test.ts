import { describe, expect, it } from "vitest"
import { DEFAULT_APPEARANCE, DEFAULT_DARK_COLORS, pageBackgroundCss } from "../src/index.ts"

describe("the page behind a form on its own", () => {
  it("gives a see-through form a page its text reads on", () => {
    const forDarkSite = {
      ...DEFAULT_APPEARANCE,
      colors: { ...DEFAULT_DARK_COLORS, background: "transparent" as const },
    }
    expect(pageBackgroundCss(forDarkSite, "body")).toBe("body{background:#111111!important}")
    const forLightSite = {
      ...DEFAULT_APPEARANCE,
      colors: { ...DEFAULT_APPEARANCE.colors, background: "transparent" as const },
    }
    expect(pageBackgroundCss(forLightSite, "body")).toBe("body{background:#ffffff!important}")
  })

  it("puts a form with its own background on a neutral page, and follows dark mode", () => {
    expect(pageBackgroundCss(DEFAULT_APPEARANCE, "body")).toBe("body{background:#f5f5f4!important}")
    const both = { ...DEFAULT_APPEARANCE, colorMode: "light-dark" as const }
    expect(pageBackgroundCss(both, "body")).toBe(
      "body{background:#f5f5f4!important}@media (prefers-color-scheme: dark){body{background:#0a0a0a!important}}",
    )
  })
})
