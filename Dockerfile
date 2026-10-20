# Parley: one container serving the web app, the HTTP API and MCP. Needs Postgres (DATABASE_URL).
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --cwd apps/web build

FROM oven/bun:1.4.2-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
# Migrations run on every start; they're a no-op when the schema is current.
CMD ["sh", "-c", "bun packages/db/src/migrate.ts && bun apps/web/serve.ts"]
