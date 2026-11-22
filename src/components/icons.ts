// T0.9 (21 Nov 2026): one icon map for the whole product.
// Every icon is Lucide (ISC licence), one stroke weight, no filled variants, no coloured tiles.
// Names stay Kestrel's own, so every caller keeps working; add a name here and it is available everywhere.
import {
  ArrowRight, AtSign, Ban, Bell, BookOpen, Bookmark, Briefcase, Building2, CalendarDays, ChartColumn,
  Check, ChevronDown, ChevronRight, CircleCheck, ClipboardCheck, ClipboardList, Clock, Copy, CreditCard, Crown,
  Download, Edit, ExternalLink, Eye, FileText, Filter, Flag, Folder, Gauge, Globe, House, IdCard, Inbox,
  LayoutGrid, Link, List, Lock, LogOut, Mail, Mailbox, MapPin, MessageSquare, Mic, MoreHorizontal,
  PanelLeft, Pause, Pencil, Phone, Play, Plug, Plus, Puzzle, RefreshCw, Search, Send, Settings, Share2,
  ShieldCheck, SlidersHorizontal, Sparkles, Star, Tag, Trash2, TriangleAlert, Upload, User, Users,
  Workflow, X, Zap, SquarePlay, type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  // navigation and pages
  home: House, dashboard: ChartColumn, grid: LayoutGrid, list: List, bookmark: Bookmark, flag: Flag,
  eye: Eye, idcard: IdCard, briefcase: Briefcase, folder: Folder, chart: ChartColumn, gauge: Gauge,
  globe: Globe, building: Building2, clip: ClipboardList, clipboard: ClipboardCheck, steps: Workflow,
  plug: Plug, crown: Crown, star: Star, book: BookOpen, sparkles: Sparkles, bolt: Zap, chat: MessageSquare,
  message: MessageSquare, send: Send, inbox: Inbox, at: AtSign, shield: ShieldCheck, settings: Settings,
  sliders: SlidersHorizontal, user: User, people: Users, users: Users, card: CreditCard, calendar: CalendarDays,
  phone: Phone,
  // actions
  plus: Plus, check: Check, okcircle: CircleCheck, close: X, chevron: ChevronRight, chevronDown: ChevronDown,
  down: Download, arrow: ArrowRight, more: MoreHorizontal, edit: Edit, trash: Trash2, copy: Copy,
  link: Link, external: ExternalLink, share: Share2, download: Download, upload: Upload, refresh: RefreshCw,
  filter: Filter, search: Search, sidebar: PanelLeft, logout: LogOut, mic: Mic, block: Ban, pause: Pause,
  play: Play, lock: Lock, tag: Tag, warn: TriangleAlert, extension: Puzzle, placement: Mailbox,
  bell: Bell, pencil: Pencil,
  // content
  doc: FileText, file: FileText, map: MapPin, mail: Mail, video: SquarePlay, clock: Clock, pin: MapPin,
};

export type IconName = keyof typeof ICONS;

export function iconFor(name: string): LucideIcon | null {
  return ICONS[name] ?? null;
}
