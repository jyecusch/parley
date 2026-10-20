import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { LoadingScreen } from "./components/logo.tsx"
import { routeTree } from "./routeTree.gen.ts"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: (count, error) => count < 2 && isRetryable(error) } },
  })
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // While a page loads (and on the server, for pages that render only in the browser), show the mark.
    defaultPendingComponent: LoadingScreen,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  })
}

const isRetryable = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { error?: { isRetryable?: boolean } }).error?.isRetryable === true

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
