import { createFileRoute, Outlet } from "@tanstack/react-router"

/** Settings. The team layout swaps in the settings sidebar for everything under here (D90). */
export const Route = createFileRoute("/t/$teamId/settings")({ component: Outlet })
