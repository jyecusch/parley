import type { ReactNode } from "react"

const Icon = ({
  size = 16,
  width = 1.5,
  children,
}: {
  size?: number | undefined
  width?: number
  children: ReactNode
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

type P = { readonly size?: number | undefined }

export const SearchIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </Icon>
)
export const PlusIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const SidebarIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </Icon>
)
export const ContactsIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.4 3.6-5.2 7-5.2s6.2 1.8 7 5.2" />
  </Icon>
)
export const ChevronDown = ({ size = 12 }: P) => (
  <Icon size={size} width={1.75}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)
export const ChevronUp = ({ size }: P) => (
  <Icon size={size}>
    <path d="m6 15 6-6 6 6" />
  </Icon>
)
export const ChevronLeft = ({ size }: P) => (
  <Icon size={size}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
)
export const CloseIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M7 7l10 10M17 7 7 17" />
  </Icon>
)
export const MoreIcon = ({ size }: P) => (
  <Icon size={size} width={2.25}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Icon>
)
export const DisplayIcon = ({ size = 14 }: P) => (
  <Icon size={size}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
)
export const AlertIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.5h.01" />
  </Icon>
)
export const TrashIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" />
  </Icon>
)
export const RestoreIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
)
export const SwitchIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </Icon>
)
export const AgentIcon = ({ size = 8 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
  </svg>
)
