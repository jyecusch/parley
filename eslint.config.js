// ESLint runs only the Tailwind rules; Biome does everything else (`bun run lint` runs both).
// Classes use Tailwind's own scale and the theme's named tokens, never arbitrary values like
// `text-[12.5px]` or `w-[30%]`.
import tsParser from "@typescript-eslint/parser"
import { defineConfig } from "eslint/config"
import tailwindcss from "eslint-plugin-tailwindcss"

export default defineConfig([
  { ignores: ["**/dist/**", "**/node_modules/**", "docs/design/**"] },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/routeTree.gen.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { tailwindcss },
    settings: {
      tailwindcss: { cssConfigPath: "./apps/web/src/styles/app.css" },
    },
    rules: {
      "tailwindcss/no-arbitrary-value": "error",
    },
  },
])
