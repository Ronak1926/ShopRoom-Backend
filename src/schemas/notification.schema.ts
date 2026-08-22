/**
 * schemas/notification.schema.ts — Canonical NotificationDesign composition
 * schema (v2). A notification is a hierarchical VISUAL COMPOSITION TREE — not a
 * flat content list. The editor produces it, a generic recursive renderer
 * consumes it, and every mutation is validated against it before it is stored.
 *
 * Design goals (master plan + composition spec):
 *  - Fully data-driven: React renders `elements.map(renderNode)` recursively.
 *    No template-specific branches anywhere.
 *  - Groups + containers so the visual structure (cards, header, product stage)
 *    is expressed in the data, not hardcoded.
 *  - Real visual model per node: frame (with scale), layout, rich style,
 *    background composition, shadow, image fit, animation, interaction.
 *  - Design tokens, z-index layering, dynamic variables, responsive overrides.
 *  - Security: numeric fields clamped, node/child counts bounded, only known
 *    node/action types accepted, text stored as plain strings.
 */

import z from "zod";

export const SCHEMA_VERSION = 2;

// ─── Enums ──────────────────────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = [
  "NEW_ARRIVAL", "NEW_STOCK", "RESTOCK", "LIMITED_STOCK", "SALE", "FLASH_SALE",
  "OFFER", "EVENT", "ANNOUNCEMENT", "REMINDER", "CUSTOM",
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/** Element registry — the complete set of renderable node types. */
export const NODE_TYPES = [
  "GROUP", "CONTAINER", "TEXT", "RICH_TEXT", "VARIABLE_TEXT",
  "IMAGE", "PRODUCT_IMAGE", "ICON", "BADGE", "LABEL", "BUTTON",
  "SHAPE", "DIVIDER", "SPARKLE", "CIRCLE", "RECTANGLE", "LINE", "GRADIENT",
  "STOCK", "DISCOUNT", "PRICE", "OLD_PRICE", "PRODUCT_NAME", "PRODUCT_DESCRIPTION",
  "RATING", "TIMER", "PROGRESS_BAR", "AVATAR", "LOGO", "SOCIAL_PROOF",
  // Background-composition primitives — decorative art referenced by asset id.
  "DECORATION", "PARTICLES",
] as const;
export const NodeTypeSchema = z.enum(NODE_TYPES);

/** Reference to a ShopRoom-owned decorative asset (SVG art, image, or Lottie). */
export const AssetRefSchema = z.object({
  type: z.enum(["SVG", "IMAGE", "LOTTIE"]).default("SVG"),
  assetId: z.string().max(120).optional(),
  url: z.string().url().max(2048).optional(),
  naturalWidth: z.number().finite().min(0).max(20000).optional(),
  naturalHeight: z.number().finite().min(0).max(20000).optional(),
  attribution: z.object({
    photographer: z.string().max(200).optional(),
    photographerUrl: z.string().url().max(2048).optional(),
    provider: z.enum(["PEXELS", "UNSPLASH"]).optional(),
  }).optional(),
});

/**
 * Icon names a node's `content.icon` may reference.
 *
 * MUST mirror ICON_REGISTRY in
 * shoproom-frontend/src/features/notifications/icons.tsx — the renderer maps a
 * name to a component through that registry, so a name missing from it renders
 * as nothing at all. Validating here turns that silent blank into a rejected
 * save. When adding an icon to the frontend registry, add it here too.
 *
 * Note: this is NOT the same field as NotificationCategory.icon (seeded
 * Material Symbols ligatures like "local_offer") — that's category list
 * metadata on a different table and is unaffected by this enum.
 */
export const ICON_NAMES = [
  "AcUnit", "AccessTime", "AccountBalanceWallet", "Add", "Analytics", "ArrowBack",
  "ArrowDownward", "ArrowForward", "ArrowUpward", "Assignment", "AutoAwesome", "Autorenew",
  "Bolt", "Bookmark", "Build", "CalendarMonth", "Campaign", "CardGiftcard",
  "Celebration", "CheckCircleOutlined", "Checkroom", "ChevronRight", "Close", "CreditCard",
  "Delete", "Devices", "Diamond", "Discount", "Download", "Edit",
  "EditNote", "EmojiEvents", "Event", "Facebook", "Favorite", "FiberManualRecord",
  "FiberNew", "FilterList", "FlashOn", "GridView", "Help", "HighlightOff",
  "Home", "HourglassBottom", "Image", "Info", "Instagram", "Inventory2",
  "Language", "LinkedIn", "LocalFireDepartment", "LocalMall", "LocalOffer", "LocalShipping",
  "LocationOn", "Lock", "LockOpen", "Mail", "Menu", "MoreHoriz",
  "NewReleases", "Notifications", "Pause", "Percent", "Person", "Phone",
  "Pinterest", "PlayArrow", "QrCode", "RadioButtonUnchecked", "Receipt", "Reddit",
  "Redeem", "Refresh", "Remove", "RemoveShoppingCart", "Replay", "RocketLaunch",
  "Schedule", "School", "Search", "Sell", "Settings", "Share",
  "Shield", "ShoppingBag", "ShoppingCart", "Spa", "SportsSoccer", "Star",
  "Storefront", "Telegram", "ThumbUp", "Toys", "TrendingUp", "Tune",
  "Twitter", "Verified", "VerifiedUser", "Visibility", "VisibilityOff", "VolumeUp",
  "Warning", "WbSunny", "WhatsApp", "Whatshot", "WorkspacePremium", "YouTube",
] as const;
export const IconNameSchema = z.enum(ICON_NAMES);

export const ACTION_TYPES = [
  "OPEN_PRODUCT", "OPEN_ROOM", "OPEN_CHAT", "OPEN_COLLECTION", "OPEN_URL", "JOIN_ROOM", "NONE",
] as const;

export const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut"] as const;
export const DESIGN_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const DESIGN_SOURCES = [
  "SHOPROOM_TEMPLATE", "USER_TEMPLATE", "CUSTOM", "DUPLICATED",
] as const;

// Bounds against pathological payloads.
export const MAX_TOP_LEVEL = 100;
export const MAX_CHILDREN = 60;

// ─── Primitives ─────────────────────────────────────────────────────────────────

const num = z.number().finite();
const coordinate = num.min(-20000).max(20000);
const dimension = num.min(0).max(20000);
/** A CSS colour string (hex / rgb / rgba / hsl / "transparent"). Bounded. */
const colorString = z.string().min(1).max(64);

const FrameSchema = z.object({
  x: coordinate,
  y: coordinate,
  width: dimension,
  height: dimension,
  rotation: num.min(-360).max(360).default(0),
  // Negative scale is how a horizontal/vertical flip is expressed (see the
  // Image inspector's Flip controls), so the range spans both signs.
  scaleX: num.min(-20).max(20).default(1),
  scaleY: num.min(-20).max(20).default(1),
  zIndex: z.number().int().min(0).max(100000).default(0),
});

const PaddingSchema = z.union([
  num.min(0).max(4000),
  z.object({
    top: num.min(0).max(4000).default(0),
    right: num.min(0).max(4000).default(0),
    bottom: num.min(0).max(4000).default(0),
    left: num.min(0).max(4000).default(0),
  }).partial(),
]);

const GradientStopSchema = z.object({
  offset: num.min(0).max(1),
  color: colorString,
});
const GradientSchema = z.object({
  type: z.enum(["LINEAR", "RADIAL"]).default("LINEAR"),
  angle: num.min(0).max(360).default(160),
  stops: z.array(GradientStopSchema).min(2).max(8),
});

const ShadowSchema = z.object({
  enabled: z.boolean().default(true),
  x: num.min(-400).max(400).default(0),
  y: num.min(-400).max(400).default(8),
  blur: num.min(0).max(600).default(24),
  spread: num.min(-400).max(400).default(0),
  color: colorString.default("rgba(15,23,42,0.14)"),
  inset: z.boolean().optional(),
});

const BorderSchema = z.object({
  width: num.min(0).max(200).default(1),
  color: colorString.default("rgba(255,255,255,0.3)"),
  style: z.enum(["solid", "dashed", "dotted"]).default("solid"),
});

/** Background composition — usable on the canvas and on any container node. */
export const BackgroundSchema = z.object({
  type: z.enum(["SOLID", "GRADIENT", "IMAGE", "PATTERN", "NONE"]).default("SOLID"),
  color: colorString.optional(),
  gradient: GradientSchema.optional(),
  assetId: z.string().max(64).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  opacity: num.min(0).max(1).optional(),
  blur: num.min(0).max(400).optional(),
  overlayColor: colorString.optional(),
  pattern: z.string().max(64).optional(),
});

const LayoutSchema = z.object({
  position: z.enum(["absolute", "relative"]).optional(),
  anchor: z.enum([
    "top-left", "top-center", "top-right", "center-left", "center",
    "center-right", "bottom-left", "bottom-center", "bottom-right",
  ]).optional(),
  overflow: z.enum(["visible", "hidden"]).optional(),
  direction: z.enum(["row", "column"]).optional(),
  gap: num.min(0).max(2000).optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  justify: z.enum(["start", "center", "end", "between", "around"]).optional(),
  padding: PaddingSchema.optional(),
});

export const StyleSchema = z.object({
  color: colorString.optional(),
  backgroundColor: colorString.optional(),
  backgroundGradient: GradientSchema.optional(),
  opacity: num.min(0).max(1).optional(),
  fontFamily: z.string().max(120).optional(),
  fontSize: num.min(1).max(800).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  lineHeight: num.min(0).max(10).optional(),
  letterSpacing: num.min(-40).max(200).optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  textDecoration: z.enum(["none", "underline", "line-through"]).optional(),
  whiteSpace: z.enum(["normal", "nowrap"]).optional(),
  verticalAlign: z.enum(["top", "center", "bottom"]).optional(),
  maxLines: z.number().int().min(1).max(50).optional(),
  overflow: z.enum(["visible", "hidden", "clip", "ellipsis"]).optional(),
  textShadow: ShadowSchema.optional(),
  gradientText: GradientSchema.optional(),
  borderRadius: num.min(0).max(9999).optional(),
  border: BorderSchema.optional(),
  padding: PaddingSchema.optional(),
  shadow: ShadowSchema.optional(),
  glow: z.object({
    enabled: z.boolean().default(true),
    color: colorString.default("#7C6AE8"),
    blur: num.min(0).max(200).default(16),
    opacity: num.min(0).max(1).default(0.6),
  }).optional(),
  blur: num.min(0).max(400).optional(),
  backdropBlur: num.min(0).max(400).optional(),
  // Generic shape clip for badge/label/image nodes — a silhouette applied via CSS
  // clip-path (or border-radius for the circular ones). Independent of borderRadius.
  clipShape: z.enum([
    "pill", "circle", "hexagon", "diamond", "shield", "star", "burst",
    "rectangle", "rounded", "ellipse", "blob",
  ]).optional(),
});

export const ContentSchema = z.object({
  text: z.string().max(2000).optional(),
  source: z.enum(["STATIC", "DYNAMIC"]).optional(),
  variable: z.string().max(120).optional(),
  label: z.string().max(200).optional(),
  // Must resolve in the renderer's icon registry — an unknown name would
  // render as nothing at all, so it's rejected here rather than saved blank.
  icon: IconNameSchema.optional(),
  iconPosition: z.enum(["left", "right", "only", "none"]).optional(),
  iconSize: num.min(4).max(200).optional(),
  value: z.union([z.string().max(200), num]).optional(),
  endAt: z.string().datetime().optional(),
  rating: num.min(0).max(5).optional(),
  progress: num.min(0).max(1).optional(),
  spans: z.array(z.object({ text: z.string().max(500), style: StyleSchema.optional() })).max(30).optional(),
});

const ImageCropSchema = z.object({
  x: num.min(0).max(1),
  y: num.min(0).max(1),
  width: num.min(0.01).max(1),
  height: num.min(0.01).max(1),
});

const ImageFiltersSchema = z.object({
  brightness: num.min(0).max(3).optional(),
  contrast: num.min(0).max(3).optional(),
  saturate: num.min(0).max(3).optional(),
  hueRotate: num.min(0).max(360).optional(),
  grayscale: num.min(0).max(1).optional(),
});

const ImageOverlaySchema = z.object({
  color: colorString.optional(),
  gradient: GradientSchema.optional(),
  opacity: num.min(0).max(1).optional(),
  blendMode: z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten"]).optional(),
});

const ImageConfigSchema = z.object({
  fit: z.enum(["cover", "contain", "fill", "none"]).default("contain"),
  position: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
  opacity: num.min(0).max(1).default(1),
  borderRadius: num.min(0).max(9999).optional(),
  // Non-destructive crop rect (fractions of the natural image) — when set, this
  // takes precedence over fit/position at render time.
  crop: ImageCropSchema.optional(),
  filters: ImageFiltersSchema.optional(),
  overlay: ImageOverlaySchema.optional(),
});

const AnimStepSchema = z.object({
  type: z.string().max(64),
  durationMs: z.number().int().min(0).max(60000).default(400),
  delayMs: z.number().int().min(0).max(60000).default(0),
  easing: z.enum(EASINGS).default("easeOut"),
  intensity: num.min(0).max(20).optional(),
  repeat: z.union([z.number().int().min(0).max(1000), z.literal("infinite")]).optional(),
});
export const AnimationSchema = z.object({
  entry: AnimStepSchema.optional(),
  attention: AnimStepSchema.optional(),
  exit: AnimStepSchema.nullish(),
});

export const ActionSchema = z
  .object({
    type: z.enum(ACTION_TYPES),
    target: z.string().max(256).optional(),
    url: z.string().url().max(2048).optional(),
  })
  .refine((a) => a.type !== "OPEN_URL" || (!!a.url && /^https?:\/\//i.test(a.url)), {
    message: "OPEN_URL requires a valid http(s) url",
    path: ["url"],
  });

const InteractionSchema = z.object({
  onClick: ActionSchema.optional(),
  onHover: ActionSchema.optional(),
  onPress: ActionSchema.optional(),
});

const ViewOverrideSchema = z.object({
  hidden: z.boolean().optional(),
  frame: FrameSchema.partial().optional(),
  style: StyleSchema.optional(),
});
const ResponsiveSchema = z.object({
  banner: ViewOverrideSchema.optional(),
  expanded: ViewOverrideSchema.optional(),
  desktop: ViewOverrideSchema.optional(),
});

// ─── Recursive node ───────────────────────────────────────────────────────────────

export interface CompositionNode {
  id: string;
  type: (typeof NODE_TYPES)[number];
  frame: z.infer<typeof FrameSchema>;
  layout?: z.infer<typeof LayoutSchema>;
  style?: z.infer<typeof StyleSchema>;
  content?: z.infer<typeof ContentSchema>;
  image?: z.infer<typeof ImageConfigSchema>;
  asset?: z.infer<typeof AssetRefSchema>;
  background?: z.infer<typeof BackgroundSchema>;
  animation?: z.infer<typeof AnimationSchema>;
  interaction?: z.infer<typeof InteractionSchema>;
  responsive?: z.infer<typeof ResponsiveSchema>;
  visible: boolean;
  locked: boolean;
  children?: CompositionNode[];
}

export const NodeSchema: z.ZodType<CompositionNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    type: NodeTypeSchema,
    frame: FrameSchema,
    layout: LayoutSchema.optional(),
    style: StyleSchema.optional(),
    content: ContentSchema.optional(),
    image: ImageConfigSchema.optional(),
    asset: AssetRefSchema.optional(),
    background: BackgroundSchema.optional(),
    animation: AnimationSchema.optional(),
    interaction: InteractionSchema.optional(),
    responsive: ResponsiveSchema.optional(),
    visible: z.boolean().default(true),
    locked: z.boolean().default(false),
    children: z.array(NodeSchema).max(MAX_CHILDREN).optional(),
  }),
);

// ─── Design tokens ────────────────────────────────────────────────────────────────

const TypographyTokenSchema = z.object({
  fontFamily: z.string().max(120).optional(),
  fontSize: num.min(1).max(800).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  lineHeight: num.min(0).max(10).optional(),
  letterSpacing: num.min(-40).max(200).optional(),
});
const DesignTokensSchema = z.object({
  colors: z.record(z.string().max(64), colorString).optional(),
  typography: z.record(z.string().max(64), TypographyTokenSchema).optional(),
  radius: z.record(z.string().max(64), num.min(0).max(9999)).optional(),
  shadows: z.record(z.string().max(64), ShadowSchema).optional(),
  spacing: z.record(z.string().max(64), num.min(0).max(9999)).optional(),
});

// ─── Canvas + Design ──────────────────────────────────────────────────────────────

export const CanvasSchema = z.object({
  width: num.min(1).max(8000),
  height: num.min(1).max(8000),
  background: BackgroundSchema,
});

export const DesignMetadataSchema = z.object({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.enum(DESIGN_SOURCES),
});

export const NotificationDesignSchema = z.object({
  schemaVersion: z.number().int().min(1),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  category: NotificationTypeSchema,
  status: z.enum(DESIGN_STATUSES),
  designTokens: DesignTokensSchema.optional(),
  canvas: CanvasSchema,
  elements: z.array(NodeSchema).max(MAX_TOP_LEVEL),
  globalAnimation: AnimationSchema.optional(),
  // Total playback duration for the Timeline's Play/scrub control — every
  // element's animation delay/duration is measured against this window.
  timeline: z.object({ durationMs: z.number().int().min(500).max(60000).default(4000) }).optional(),
  metadata: DesignMetadataSchema,
});

// ─── Inferred types ───────────────────────────────────────────────────────────────

export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export type NodeType = z.infer<typeof NodeTypeSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type Style = z.infer<typeof StyleSchema>;
export type NotificationCanvas = z.infer<typeof CanvasSchema>;
export type NotificationDesign = z.infer<typeof NotificationDesignSchema>;
