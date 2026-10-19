// Used only by `bunx auth generate` to emit the Drizzle schema for Better-Auth's tables.
import { drizzle } from "drizzle-orm/node-postgres"
import { makeAuth } from "./src/auth/better-auth.ts"

export const auth = makeAuth({
  db: drizzle.mock(),
  schema: {},
  secret: "generate-only-secret-generate-only-secret",
  baseURL: "http://localhost:3000",
  connections: { pendingFor: async () => undefined, authorize: async () => {} },
})
