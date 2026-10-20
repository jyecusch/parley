/**
 * The production server. `vite build` turns the app into a fetch handler (dist/server/server.js) and static
 * files (dist/client); this serves the static files itself and hands every other request to the app.
 */
import { join, normalize } from "node:path"
import app from "./dist/server/server.js"

const CLIENT = join(import.meta.dir, "dist/client")
const port = Number(process.env.PORT) || 3000

/** Hashed build files never change, so browsers may keep them; the icons may change between releases. */
const cacheControl = (path: string) =>
  path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600"

Bun.serve({
  port,
  hostname: "0.0.0.0",
  // MCP and long requests stream; Bun's default closes a connection after 10s without data.
  idleTimeout: 255,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (request.method === "GET" || request.method === "HEAD") {
      const path = normalize(decodeURIComponent(pathname))
      if (!path.includes("..") && path !== "/") {
        const file = Bun.file(join(CLIENT, path))
        if (await file.exists()) {
          return new Response(file, {
            headers: { "cache-control": cacheControl(path), "x-content-type-options": "nosniff" },
          })
        }
      }
    }
    return app.fetch(request)
  },
})

console.log(`Parley is listening on port ${port}`)
