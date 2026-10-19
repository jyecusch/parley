import { createFileRoute } from "@tanstack/react-router"
import { handle } from "../server/app.ts"

/** OAuth discovery for agents connecting over MCP (D89). */
export const Route = createFileRoute("/.well-known/$")({
  server: { handlers: { GET: ({ request }) => handle(request) } },
})
