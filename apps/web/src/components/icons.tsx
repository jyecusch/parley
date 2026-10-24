import {
  ArrowLeft,
  Bot,
  Building,
  Check,
  ChevronsUpDown,
  CircleAlert,
  ClipboardList,
  Columns2,
  Copy,
  Download,
  Ellipsis,
  GripVertical,
  Image,
  Info,
  KeyRound,
  Link,
  List,
  Lock,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronUp as LucideChevronUp,
  type LucideIcon,
  Mail,
  Maximize2,
  Minimize2,
  Minus,
  PanelLeft,
  Pencil,
  Plug,
  Plus,
  RectangleHorizontal,
  Rows2,
  Search,
  Send,
  Settings,
  Settings2,
  SlidersHorizontal,
  Sparkle,
  Stamp,
  SwatchBook,
  Trash,
  TriangleAlert,
  Undo2,
  Upload,
  User,
  Users,
  UsersRound,
  X,
} from "lucide-react"
import { cn } from "./ui/cn.ts"

/*
 * The app's icons, from Lucide, under the names the screens use. Sized by Tailwind classes
 * (size-5 unless a default below says otherwise), drawn at Lucide's stroke scaled to Parley's
 * lighter 1.5.
 */

type P = { readonly className?: string | undefined; readonly strokeWidth?: number | undefined }

const icon =
  (Lucide: LucideIcon, defaults: { readonly className?: string; readonly strokeWidth?: number } = {}) =>
  ({ className, strokeWidth }: P) => (
    <Lucide
      aria-hidden="true"
      className={cn("size-5 shrink-0", defaults.className, className)}
      strokeWidth={strokeWidth ?? defaults.strokeWidth ?? 1.5}
    />
  )

export const SearchIcon = icon(Search)
export const PlusIcon = icon(Plus)
export const SidebarIcon = icon(PanelLeft)
export const ContactsIcon = icon(User)
export const ChevronDown = icon(LucideChevronDown, { className: "size-3.5", strokeWidth: 1.75 })
export const ChevronUp = icon(LucideChevronUp)
export const ChevronLeft = icon(LucideChevronLeft)
export const CloseIcon = icon(X)
export const MoreIcon = icon(Ellipsis, { strokeWidth: 2.25 })
export const DisplayIcon = icon(Settings2, { className: "size-4" })
export const AlertIcon = icon(CircleAlert)
export const TrashIcon = icon(Trash)
export const RestoreIcon = icon(Undo2)
export const SwitchIcon = icon(ChevronsUpDown)
/** The small mark on an avatar for something an agent did. */
export const AgentIcon = icon(Sparkle, { className: "size-2.5 fill-current", strokeWidth: 0 })
export const BackIcon = icon(ArrowLeft)
export const SettingsIcon = icon(Settings)
export const MembersIcon = icon(Users)
export const ServiceAccountIcon = icon(Bot)
export const ConnectionIcon = icon(Plug)
export const KeyIcon = icon(KeyRound)
export const InfoIcon = icon(Info)
export const WarnIcon = icon(TriangleAlert)
export const CopyIcon = icon(Copy, { className: "size-4" })
export const CheckIcon = icon(Check, { className: "size-4", strokeWidth: 1.75 })
export const LockIcon = icon(Lock, { className: "size-3.5", strokeWidth: 1.75 })
export const CompaniesIcon = icon(Building)
export const MailIcon = icon(Mail)
export const SegmentIcon = icon(UsersRound)
export const TemplateIcon = icon(Stamp)
export const SendIcon = icon(Send)
export const ExpandIcon = icon(Maximize2)
export const CollapseIcon = icon(Minimize2)
export const TuneIcon = icon(SlidersHorizontal)
export const LinkIcon = icon(Link)
export const ListIcon = icon(List)
export const ImageIcon = icon(Image)
export const ButtonShapeIcon = icon(RectangleHorizontal)
export const DividerIcon = icon(Minus)
export const EmailStyleIcon = icon(SwatchBook)
export const PencilIcon = icon(Pencil, { className: "size-3.5", strokeWidth: 1.75 })
export const SideBySideIcon = icon(Columns2)
export const StackedIcon = icon(Rows2)
export const DownloadIcon = icon(Download)
export const UploadIcon = icon(Upload)
export const FormIcon = icon(ClipboardList)
export const GripIcon = icon(GripVertical)
