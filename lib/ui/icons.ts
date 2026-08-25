/**
 * Canonical icon map. Toda feature importa daqui — não direto de @phosphor-icons/react.
 * ADR-05 (Spec 09 §12). Permite swap futuro sem big-bang refactor.
 *
 * Re-exporting from `@phosphor-icons/react/dist/ssr` so Server Components can
 * render icons without forcing the entire CSR React-context module client-side.
 * Client Components still get fully interactive icons (size/weight/color).
 */

export {
  // navigation (inbox icon = Tray in Phosphor)
  Tray as Inbox,
  // sala de reuniões — a câmera é o Meet; o copiloto mora lá
  VideoCamera,
  PlugsConnected,
  QrCode,
  Kanban,
  Users,
  UsersThree,
  Storefront,
  Robot,
  Sparkle,
  ShieldCheck,
  Gear,
  House,
  // admin platform
  Buildings,
  FlowArrow,
  ChatsCircle,
  ClipboardText,
  Scales,
  Gauge,
  WifiSlash,
  Clock,
  // health dashboard
  WifiHigh,
  Brain,
  ArrowsClockwise,
  Dot,
  // actions
  Bell,
  PaperPlaneTilt,
  Smiley,
  Check,
  Checks,
  X,
  Plus,
  Trash,
  PencilSimple,
  MagnifyingGlass,
  Pause,
  Play,
  SkipForward,
  Copy,
  DownloadSimple,
  Archive,
  // feedback
  CheckCircle,
  // o "cale a boca" do copiloto da ligação — a sugestão que manda NÃO falar
  HandPalm,
  Warning,
  WarningOctagon,
  Info,
  CircleNotch,
  // lgpd
  Scales as ScalesSimple,
  Eye,
  ChartBar,
  ClockCountdown,
  // painéis de evolução / aprendizado
  ChartLineUp,
  Lightbulb,
  // theme
  Sun,
  Moon,
  MonitorPlay,
  // conversation
  ChatCircle,
  Phone,
  WhatsappLogo,
  // contatos do negócio (0103) — o cartão que o lead manda no meio da conversa
  AddressBook,
  UserPlus,
  // prospecção — link de volta pro anúncio do Google Maps no dossiê do lead
  MapPin,
  Paperclip,
  Microphone,
  Image as ImageIcon,
  ImageSquare,
  // gaveta de salvos do composer: guarda áudio E foto, então nada de nota
  // musical. Marcador = "isto eu guardei". Archive não serve: no CRM ele já
  // quer dizer "arquivar", que é o contrário (tirar de circulação).
  BookmarkSimple,
  MusicNote,
  Note,
  FileText,
  Lock,
  Receipt,
  Tag,
  Question,
  Keyboard,
  // followup flow builder (Task 6.2)
  GitBranch,
  Flag,
  // redesign Nexo IA — os ícones da nova pele
  // `ArrowUpRight` é o ↗ do botão circular que abre o detalhe de cada card:
  // é a assinatura do layout e aparece em TODO card de KPI.
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Export,
  ArrowsDownUp,
  FunnelSimple,
  CurrencyDollar,
  Target,
  CalendarBlank,
  // misc
  DotsThree,
  CaretDown,
  CaretUp,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  ArrowRight,
  SignOut,
  WebhooksLogo,
  PuzzlePiece,
  UploadSimple,
  Signpost,
  // guias in-app (Configurações › Guias)
  BookOpen,
  ListBullets,
} from "@phosphor-icons/react/dist/ssr";
