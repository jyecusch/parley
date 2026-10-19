export type ThemeChoice = "system" | "light" | "dark"

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows can refuse storage; the choice then lasts for this page only.
  }
}

export const themeChoice = (): ThemeChoice => {
  const value = read("parley.theme")
  return value === "light" || value === "dark" ? value : "system"
}

export const applyTheme = (choice: ThemeChoice) => {
  write("parley.theme", choice)
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.dataset.theme = dark ? "dark" : "light"
}

/** CRT is an opt-in appearance mode, never the default (D81). */
export const crtEnabled = () => read("parley.crt") === "amber"

export const setCrt = (on: boolean) => {
  write("parley.crt", on ? "amber" : "off")
  if (on) document.documentElement.dataset.crt = "amber"
  else delete document.documentElement.dataset.crt
}

export const sidebarCollapsed = () => read("parley.sidebar") === "collapsed"
export const setSidebarCollapsed = (collapsed: boolean) => write("parley.sidebar", collapsed ? "collapsed" : "expanded")
