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
export const BackIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
)
export const SettingsIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" />
  </Icon>
)
export const MembersIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 15.2c1.6.6 2.6 2 3 4.3" />
  </Icon>
)
export const ServiceAccountIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="4.5" y="7.5" width="15" height="11" rx="3" />
    <path d="M12 4v3.5M9.5 12.5v1M14.5 12.5v1" />
  </Icon>
)
export const ConnectionIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M9 7V3.5M15 7V3.5M6.5 7h11v4a5.5 5.5 0 0 1-11 0zM12 16.5v4" />
  </Icon>
)
export const KeyIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" />
  </Icon>
)
export const InfoIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </Icon>
)
export const WarnIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M12 3.5 21 19.5H3z" />
    <path d="M12 10v4M12 16.8h.01" />
  </Icon>
)
export const CopyIcon = ({ size = 14 }: P) => (
  <Icon size={size}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Icon>
)
export const CheckIcon = ({ size = 14 }: P) => (
  <Icon size={size} width={1.75}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)
export const LockIcon = ({ size = 12 }: P) => (
  <Icon size={size} width={1.75}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
)
export const CompaniesIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4.5 20.5v-14a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14M15.5 10.5h2a2 2 0 0 1 2 2v8M3 20.5h18M8.5 8.5h3M8.5 12h3M8.5 15.5h3" />
  </Icon>
)
export const MailIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
)
export const SegmentIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="9" cy="9" r="3" />
    <circle cx="16" cy="11" r="2.5" />
    <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M14.5 15.2c.5-.2 1-.2 1.5-.2 2.2 0 3.8 1.2 4.3 4" />
  </Icon>
)
export const TemplateIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M8 8h8M8 11.5h8M8 15h5" />
  </Icon>
)
export const SendIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M20.5 3.5 10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4 17-6.5Z" />
  </Icon>
)
