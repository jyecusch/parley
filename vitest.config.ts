import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // Tests never reach the network for company logos. The webhook secret is a made-up test value
    // ("test-webhook-secret-123456789" in base64), without Resend's whsec_ prefix, which Parley
    // accepts either way, so secret scanners don't mistake it for a real one.
    env: { FETCH_LOGOS: "false", RESEND_WEBHOOK_SECRET: "dGVzdC13ZWJob29rLXNlY3JldC0xMjM0NTY3ODk=" },
  },
})
