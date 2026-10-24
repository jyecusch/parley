import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react"
import { Button } from "./button.tsx"
import { cn } from "./cn.ts"

/**
 * The frame for pages outside the app: sign-in, sign-up, a new team, an invitation and the
 * unsubscribe page. One narrow column, centered in the window.
 */
export function AuthPage({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-6">
      <div className={cn("flex w-full max-w-md flex-col gap-4", className)} {...props}>
        {children}
      </div>
    </main>
  )
}

/** A public page's title and the sentence under it. */
export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <h1 className="m-0 text-xl font-semibold tracking-tight">{title}</h1>
      {children ? <p className="m-0 text-muted">{children}</p> : null}
    </div>
  )
}

/** A button that reads as a link in a sentence, such as "Use another account". */
export function LinkButton({ type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button type={type} variant="link" size="none" {...props} />
}
