import { createFileRoute } from "@tanstack/react-router"
import { handle } from "../server/app.ts"

/** Images hosted for email (D120), served publicly by the Effect server. */
export const Route = createFileRoute("/i/$imageId")({
  server: { handlers: { GET: ({ request }) => handle(request) } },
})
