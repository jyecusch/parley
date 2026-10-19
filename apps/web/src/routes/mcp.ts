import { createFileRoute } from "@tanstack/react-router"
import { handle } from "../server/app.ts"

export const Route = createFileRoute("/mcp")({
  server: { handlers: { ANY: ({ request }) => handle(request) } },
})
