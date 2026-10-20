import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // Under portless, PORT and HOST are assigned per run and the app is reached at its .localhost URL.
  // Without it (`bun run dev:app`), the app falls back to http://localhost:3000.
  server: {
    port: Number(process.env.PORT) || 3000,
    strictPort: process.env.PORT !== undefined,
    ...(process.env.HOST ? { host: process.env.HOST } : {}),
  },
  // Native modules load their binaries at runtime, so the server build leaves them in node_modules.
  ssr: { external: ["sharp"] },
  plugins: [tailwindcss(), tanstackStart(), react()],
})
