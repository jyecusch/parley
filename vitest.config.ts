import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // Tests never reach the network for company logos.
    env: { FETCH_LOGOS: "false" },
  },
})
