"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

/*
 * shadcn's Toaster (on sonner) for Parley (D139). Toasts are drawn by showToast (overlay.tsx) in
 * Parley's look, so sonner's own styles and theme don't apply: it only places, stacks, times and
 * announces them. Mount one inside the app's screen, so CRT mode draws toasts too.
 */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    className="toaster group"
    position="bottom-center"
    offset={20}
    visibleToasts={1}
    // Sonner's toast is as wide as its stack; Parley's pill sits centered in it.
    toastOptions={{ unstyled: true, classNames: { toast: "flex w-full justify-center" } }}
    {...props}
  />
)

export { Toaster }
