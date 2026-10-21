import { createContext, useContext } from "react"

/**
 * Where popups render (tooltips, menus, popovers, dialogs): the screen the app is drawn in, so CRT
 * mode draws them too (D81) and no panel clips them (D139). Outside one, they render into the body.
 */
export const PortalContainer = createContext<HTMLElement | null>(null)

/** The element popups render into, as Base UI's Portal `container` takes it. */
export const usePortalContainer = () => useContext(PortalContainer) ?? undefined
