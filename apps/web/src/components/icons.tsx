import type { ReactNode } from "react"
import { cn } from "./ui/cn.ts"

/** Icons are sized by Tailwind classes (default size-5), never by pixel values. */
const Icon = ({
  className,
  width = 1.5,
  children,
}: {
  className?: string | undefined
  width?: number
  children: ReactNode
}) => (
  <svg
    className={cn("size-5 shrink-0", className)}
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

type P = { readonly className?: string | undefined }

export const SearchIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </Icon>
)
export const PlusIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const SidebarIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </Icon>
)
export const ContactsIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.4 3.6-5.2 7-5.2s6.2 1.8 7 5.2" />
  </Icon>
)
export const ChevronDown = ({ className = "size-3.5" }: P) => (
  <Icon className={className} width={1.75}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)
export const ChevronUp = ({ className }: P) => (
  <Icon className={className}>
    <path d="m6 15 6-6 6 6" />
  </Icon>
)
export const ChevronLeft = ({ className }: P) => (
  <Icon className={className}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
)
export const CloseIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M7 7l10 10M17 7 7 17" />
  </Icon>
)
export const MoreIcon = ({ className }: P) => (
  <Icon className={className} width={2.25}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Icon>
)
export const DisplayIcon = ({ className = "size-4" }: P) => (
  <Icon className={className}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
)
export const AlertIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.5h.01" />
  </Icon>
)
export const TrashIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" />
  </Icon>
)
export const RestoreIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
)
export const SwitchIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </Icon>
)
export const AgentIcon = ({ className = "size-2.5" }: P) => (
  <svg className={cn("shrink-0", className)} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
  </svg>
)
export const BackIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
)
export const SettingsIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" />
  </Icon>
)
export const MembersIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 15.2c1.6.6 2.6 2 3 4.3" />
  </Icon>
)
export const ServiceAccountIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="4.5" y="7.5" width="15" height="11" rx="3" />
    <path d="M12 4v3.5M9.5 12.5v1M14.5 12.5v1" />
  </Icon>
)
export const ConnectionIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M9 7V3.5M15 7V3.5M6.5 7h11v4a5.5 5.5 0 0 1-11 0zM12 16.5v4" />
  </Icon>
)
export const KeyIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" />
  </Icon>
)
export const InfoIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </Icon>
)
export const WarnIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3.5 21 19.5H3z" />
    <path d="M12 10v4M12 16.8h.01" />
  </Icon>
)
export const CopyIcon = ({ className = "size-4" }: P) => (
  <Icon className={className}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Icon>
)
export const CheckIcon = ({ className = "size-4" }: P) => (
  <Icon className={className} width={1.75}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)
export const LockIcon = ({ className = "size-3.5" }: P) => (
  <Icon className={className} width={1.75}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
)
export const CompaniesIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4.5 20.5v-14a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14M15.5 10.5h2a2 2 0 0 1 2 2v8M3 20.5h18M8.5 8.5h3M8.5 12h3M8.5 15.5h3" />
  </Icon>
)
export const MailIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
)
export const SegmentIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="9" cy="9" r="3" />
    <circle cx="16" cy="11" r="2.5" />
    <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M14.5 15.2c.5-.2 1-.2 1.5-.2 2.2 0 3.8 1.2 4.3 4" />
  </Icon>
)
export const TemplateIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M8 8h8M8 11.5h8M8 15h5" />
  </Icon>
)
export const SendIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M20.5 3.5 10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4 17-6.5Z" />
  </Icon>
)
export const ExpandIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6" />
  </Icon>
)
export const CollapseIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M19.5 10H14V4.5M4.5 14H10v5.5M14 10l5.5-5.5M10 14l-5.5 5.5" />
  </Icon>
)
export const TuneIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
)
export const LinkIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </Icon>
)
export const ListIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </Icon>
)
export const ImageIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 16l-5-5-8 8" />
  </Icon>
)
export const ButtonShapeIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3" y="7" width="18" height="10" rx="3" />
  </Icon>
)
export const DividerIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M3 12h18" />
  </Icon>
)
export const PaletteIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.9-.3-1 .4-2.1 1.5-2.1H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z" />
    <circle cx="7.5" cy="11" r="1" />
    <circle cx="10" cy="7" r="1" />
    <circle cx="14.5" cy="7" r="1" />
  </Icon>
)
/** Two panes side by side, for a layout toggle. */
export const SideBySideIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M12 4.5v15" />
  </Icon>
)
/** Two panes stacked, for a layout toggle. */
export const StackedIcon = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M3.5 12h17" />
  </Icon>
)
