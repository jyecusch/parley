import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // Tests never reach the network for company logos.
    env: { FETCH_LOGOS: "false", RESEND_WEBHOOK_SECRET: "whsec_dGVzdC13ZWJob29rLXNlY3JldC0xMjM0NTY3ODk=" },
  },
})
