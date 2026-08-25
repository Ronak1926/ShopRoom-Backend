/**
 * prisma/notificationTemplates.ts — ShopRoom starter templates as v2 composition
 * trees.
 *
 * SCOPE: a template is the notification's BIG-PICTURE IMAGE — nothing else.
 * Android/iOS draw the app icon, app name, timestamp, title, body text and the
 * expand chevron themselves; we cannot style those. So the canvas is only the
 * image card that sits below them, which is why it is a 2:1 landscape banner
 * (400×200) rather than a phone screen.
 *
 * That constraint drives the layout language: one main visual, a short headline,
 * one supporting line, and at most one small call-to-action. No feature lists,
 * no progress bars, no full-height hero sections — those belong on a landing
 * page, not in a notification.
 *
 * Standard UI icons are stored as MUI icon names (content.icon) — never inline
 * SVG. Decorative art is referenced by asset id. Layout convention:
 *   node(id, type, x, y, w, h, extra, z)   — children/style/etc. live in extra.
 */

import {
  NotificationDesignSchema,
  type NotificationType,
} from "../src/schemas/notification.schema.js";

/** 2:1 big-picture banner — the only surface a shop actually controls. */
const CANVAS_W = 400;
const CANVAS_H = 200;

/** Copy column on the left; the hero visual occupies the right third. */
const PAD = 22;
const TEXT_W = 198;
const VISUAL_X = 232;
const VISUAL_W = 148;
const VISUAL_CX = VISUAL_X + VISUAL_W / 2;

// ── Node + decoration helpers ────────────────────────────────────────────────────

interface Extra {
  style?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  content?: Record<string, unknown>;
  image?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  children?: unknown[];
}
function node(id: string, type: string, x: number, y: number, w: number, h: number, extra: Extra = {}, z = 0) {
  return { id, type, frame: { x, y, width: w, height: h, zIndex: z }, ...extra };
}
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const fadeIn = (delayMs: number) => ({ entry: { type: "FADE_IN", durationMs: 450, delayMs, easing: "easeOut" } });

interface DecoOpts { color?: string; opacity?: number; z?: number; rotation?: number }
function deco(id: string, assetId: string, x: number, y: number, w: number, h: number, o: DecoOpts = {}) {
  return {
    id,
    type: "DECORATION",
    asset: { type: "SVG", assetId },
    frame: { x, y, width: w, height: h, rotation: o.rotation ?? 0, zIndex: o.z ?? 2 },
    style: { ...(o.color ? { color: o.color } : {}), ...(o.opacity != null ? { opacity: o.opacity } : {}) },
  };
}

// ── Theme ────────────────────────────────────────────────────────────────────────

interface Theme { tintTop: string; tintSoft: string; accent: string; accentDark: string; ink: string }

const THEMES: Record<string, Theme> = {
  purple: { tintTop: "#EDE7FE", tintSoft: "#FBFAFF", accent: "#5B47D4", accentDark: "#3A2DB0", ink: "#2E1065" },
  green: { tintTop: "#DCF3E7", tintSoft: "#F7FDFA", accent: "#0F9D6B", accentDark: "#0A7A52", ink: "#08422E" },
  blue: { tintTop: "#DEEBFD", tintSoft: "#F8FBFF", accent: "#2563EB", accentDark: "#1D4ED8", ink: "#0B2E6B" },
  amber: { tintTop: "#FCEFD6", tintSoft: "#FFFCF5", accent: "#D97706", accentDark: "#B45309", ink: "#5A3406" },
  pink: { tintTop: "#FBDEE6", tintSoft: "#FFF8FA", accent: "#E11D48", accentDark: "#BE123C", ink: "#6B0F24" },
  red: { tintTop: "#FBDCD8", tintSoft: "#FFF8F6", accent: "#DC2626", accentDark: "#B91C1C", ink: "#6B1210" },
  violet: { tintTop: "#EBDEFE", tintSoft: "#FCF9FF", accent: "#7C3AED", accentDark: "#6D28D9", ink: "#3B0F70" },
  teal: { tintTop: "#D7F0EB", tintSoft: "#F6FCFB", accent: "#0D9488", accentDark: "#0F766E", ink: "#0A3D38" },
  slate: { tintTop: "#E9ECF2", tintSoft: "#FAFBFD", accent: "#475569", accentDark: "#334155", ink: "#1E293B" },
};

// ── Hero visuals (right third of the banner) ─────────────────────────────────────

function heroProduct(t: Theme, stock?: string): unknown[] {
  const out: unknown[] = [
    deco("product-glow", "product-glow", VISUAL_CX - 74, 16, 148, 148, { color: t.accent, opacity: 0.42, z: 30 }),
    deco("product-shadow", "product-shadow", VISUAL_CX - 40, 150, 80, 16, { opacity: 0.45, z: 32 }),
    deco("pedestal", "pedestal", VISUAL_CX - 52, 142, 104, 32, { color: t.accent, opacity: 0.9, z: 34 }),
    node("product-image", "PRODUCT_IMAGE", VISUAL_CX - 52, 34, 104, 110, {
      // Reusable token — never a hardcoded URL. Resolved at render/send time.
      content: { source: "DYNAMIC", variable: "{{product.image}}" },
      image: { fit: "contain", position: "center" },
      animation: fadeIn(160),
    }, 60),
  ];
  if (stock) {
    out.push(node("stock-badge", "CONTAINER", VISUAL_X + VISUAL_W - 50, 18, 46, 46, {
      layout: { direction: "column", align: "center", justify: "center", gap: 0 },
      style: { backgroundColor: "#FFFFFF", borderRadius: 9999, shadow: { enabled: true, x: 0, y: 4, blur: 12, spread: -4, color: rgba(t.ink, 0.22) } },
      children: [
        node("stock-num", "VARIABLE_TEXT", 0, 0, 40, 18, { style: { color: t.accent, fontSize: 16, fontWeight: 800 }, content: { source: "DYNAMIC", text: stock } }),
        node("stock-left", "TEXT", 0, 0, 40, 10, { style: { color: t.ink, fontSize: 8, opacity: 0.7, textTransform: "uppercase" }, content: { text: "Left" } }),
      ],
    }, 62));
  }
  return out;
}

function heroOffer(t: Theme, percent: string): unknown[] {
  return [
    deco("offer-glow", "product-glow", VISUAL_CX - 76, 20, 152, 152, { color: t.accent, opacity: 0.5, z: 30 }),
    node("offer-card", "CONTAINER", VISUAL_CX - 62, 44, 124, 96, {
      layout: { direction: "column", align: "center", justify: "center", gap: 0 },
      style: {
        backgroundGradient: { type: "LINEAR", angle: 150, stops: [{ offset: 0, color: t.accent }, { offset: 1, color: t.accentDark }] },
        borderRadius: 20,
        shadow: { enabled: true, x: 0, y: 10, blur: 22, spread: -6, color: rgba(t.accent, 0.5) },
      },
      animation: fadeIn(140),
      children: [
        node("offer-up", "TEXT", 0, 0, 100, 12, { style: { color: "#FFFFFF", fontSize: 9, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", opacity: 0.9 }, content: { text: "Up to" } }),
        node("offer-pct", "TEXT", 0, 0, 110, 40, { style: { color: "#FFFFFF", fontSize: 36, fontWeight: 900, lineHeight: 1.05 }, content: { text: percent } }),
        node("offer-off", "TEXT", 0, 0, 100, 14, { style: { color: "#FFFFFF", fontSize: 11, fontWeight: 800, letterSpacing: 1.6 }, content: { text: "OFF" } }),
      ],
    }, 55),
    node("offer-bolt", "ICON", VISUAL_CX + 44, 32, 24, 24, { style: { color: "#F5A623", fontSize: 24 }, content: { icon: "FlashOn" } }, 62),
  ];
}

function heroIcon(t: Theme, icon: string): unknown[] {
  return [
    deco("icon-glow", "product-glow", VISUAL_CX - 70, 26, 140, 140, { color: t.accent, opacity: 0.45, z: 30 }),
    node("hero-circle", "CONTAINER", VISUAL_CX - 47, 53, 94, 94, {
      layout: { direction: "row", align: "center", justify: "center" },
      style: { backgroundColor: rgba(t.accent, 0.16), borderRadius: 9999 },
      animation: fadeIn(140),
      children: [node("hero-icon", "ICON", 0, 0, 44, 44, { style: { color: t.accent, fontSize: 42 }, content: { icon } })],
    }, 55),
  ];
}

function heroUpload(t: Theme): unknown[] {
  return [
    node("upload-box", "CONTAINER", VISUAL_X, 44, VISUAL_W - 4, 112, {
      layout: { direction: "column", align: "center", justify: "center", gap: 6 },
      style: {
        backgroundColor: "rgba(255,255,255,0.72)",
        borderRadius: 16,
        border: { width: 2, color: rgba(t.accent, 0.4), style: "dashed" },
      },
      children: [
        node("upload-icon", "ICON", 0, 0, 26, 26, { style: { color: rgba(t.accent, 0.75), fontSize: 26 }, content: { icon: "Image" } }),
        node("upload-text", "TEXT", 0, 0, 130, 14, { style: { color: t.ink, fontSize: 10, fontWeight: 600, opacity: 0.7 }, content: { text: "Add Your Image" } }),
      ],
    }, 55),
  ];
}

// ── Background composition, tuned for a wide banner ──────────────────────────────

type Motif = "nature" | "sale" | "flash" | "gift" | "event" | "announce" | "reminder" | "custom";

function buildBackground(t: Theme, motif: Motif): unknown[] {
  const A = t.accent;
  // A soft wash behind the visual, so the right side reads as a product stage.
  const back: unknown[] = [deco("bg-glow", "glow", 220, -40, 220, 220, { color: A, opacity: 0.4, z: 4 })];
  switch (motif) {
    case "nature":
      back.push(
        deco("bg-leaf-l", "leaf-sprig", -26, 92, 74, 108, { color: A, opacity: 0.16, z: 8, rotation: 16 }),
        deco("bg-sprig-r", "leaf-sprig", 356, -18, 68, 100, { color: A, opacity: 0.2, z: 8, rotation: 24 }),
        deco("bg-spark1", "sparkle", 206, 26, 13, 13, { color: A, opacity: 0.7, z: 120 }),
        deco("bg-spark2", "sparkle", 372, 128, 11, 11, { color: A, opacity: 0.6, z: 120 }),
      );
      break;
    case "sale":
      back.push(
        deco("bg-confetti", "confetti", 296, -22, 108, 108, { opacity: 0.85, z: 10 }),
        deco("bg-ring", "ring", -30, 116, 88, 88, { color: A, opacity: 0.2, z: 8 }),
        deco("bg-spark1", "sparkle", 212, 22, 13, 13, { color: A, opacity: 0.7, z: 120 }),
      );
      break;
    case "flash":
      back[0] = deco("bg-glow", "glow", 210, -50, 240, 240, { color: A, opacity: 0.52, z: 4 });
      back.push(
        deco("bg-particles", "particles", 180, 0, 220, 200, { color: A, opacity: 0.34, z: 10 }),
        deco("bg-lightning", "lightning", 196, 22, 30, 52, { color: "#F59E0B", opacity: 0.85, z: 26, rotation: 12 }),
        deco("bg-spark1", "sparkle", 380, 122, 12, 12, { color: "#F59E0B", opacity: 0.9, z: 120 }),
      );
      break;
    case "gift":
      back.push(
        deco("bg-ring1", "ring", -28, 22, 92, 92, { color: A, opacity: 0.2, z: 8 }),
        deco("bg-orb", "gradient-orb", 330, -30, 110, 110, { color: A, opacity: 0.4, z: 6 }),
        deco("bg-spark1", "sparkle", 200, 30, 13, 13, { color: A, opacity: 0.7, z: 120 }),
        deco("bg-spark2", "star", 368, 138, 11, 11, { color: "#F59E0B", opacity: 0.7, z: 120 }),
      );
      break;
    case "event":
      back.push(
        deco("bg-confetti", "confetti", 292, -20, 110, 110, { opacity: 0.85, z: 10 }),
        deco("bg-ribbon", "ribbon", -34, 128, 104, 50, { color: A, opacity: 0.24, z: 8, rotation: -12 }),
        deco("bg-spark1", "sparkle", 206, 28, 12, 12, { color: A, opacity: 0.7, z: 120 }),
      );
      break;
    case "announce":
      back.push(
        deco("bg-wave1", "wave", -18, 148, 180, 38, { color: A, opacity: 0.18, z: 8 }),
        deco("bg-dots", "dots", 348, 8, 48, 48, { color: A, opacity: 0.24, z: 8 }),
        deco("bg-ring", "ring", -34, 30, 88, 88, { color: A, opacity: 0.16, z: 8 }),
      );
      break;
    case "reminder":
      back.push(
        deco("bg-dots", "dots", -12, 18, 52, 52, { color: A, opacity: 0.22, z: 8 }),
        deco("bg-orb", "gradient-orb", 330, -26, 104, 104, { color: A, opacity: 0.35, z: 6 }),
        deco("bg-wave", "wave", 30, 156, 170, 38, { color: A, opacity: 0.16, z: 8 }),
      );
      break;
    case "custom":
      back[0] = deco("bg-glow", "glow", 220, -40, 220, 220, { color: A, opacity: 0.26, z: 4 });
      back.push(
        deco("bg-arc", "arc", 12, 138, 150, 60, { color: A, opacity: 0.14, z: 8 }),
        deco("bg-dots", "dots", 352, 10, 44, 44, { color: A, opacity: 0.16, z: 8 }),
      );
      break;
  }
  return back;
}

// ── Template spec + builder ────────────────────────────────────────────────────

type Hero =
  | { kind: "product"; stock?: string }
  | { kind: "offer"; percent: string }
  | { kind: "icon"; icon: string }
  | { kind: "upload" };

interface TemplateSpec {
  slug: string; name: string; category: NotificationType; categorySlug: string;
  theme: keyof typeof THEMES; motif: Motif;
  badge: string; badgeIcon: string;
  /** Two short lines at most — this sits inside a notification image. */
  heading: string; subheading: string;
  hero: Hero;
  /** One small call-to-action pill. */
  cta: string;
}

function buildHero(t: Theme, hero: Hero): unknown[] {
  switch (hero.kind) {
    case "product": return heroProduct(t, hero.stock);
    case "offer": return heroOffer(t, hero.percent);
    case "icon": return heroIcon(t, hero.icon);
    case "upload": return heroUpload(t);
  }
}

export function buildTemplate(spec: TemplateSpec) {
  const t = THEMES[spec.theme];
  const now = new Date().toISOString();

  const badge = node("badge", "CONTAINER", PAD, 22, 126, 24, {
    layout: { direction: "row", align: "center", justify: "center", gap: 5 },
    style: { backgroundColor: "#FFFFFF", borderRadius: 9999, shadow: { enabled: true, x: 0, y: 3, blur: 10, spread: -3, color: rgba(t.ink, 0.18) } },
    children: [
      node("badge-ic", "ICON", 0, 0, 12, 12, { style: { color: t.accent, fontSize: 12 }, content: { icon: spec.badgeIcon } }),
      node("badge-tx", "TEXT", 0, 0, 92, 12, { style: { color: t.accent, fontSize: 9, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" }, content: { text: spec.badge } }),
    ],
  }, 100);

  const heading = node("heading", "TEXT", PAD, 56, TEXT_W, 50, {
    style: { color: t.ink, fontSize: 23, fontWeight: 800, textAlign: "left", lineHeight: 1.12, letterSpacing: -0.3 },
    content: { text: spec.heading },
    animation: fadeIn(70),
  }, 90);

  const subheading = node("subheading", "TEXT", PAD, 110, TEXT_W, 28, {
    style: { color: rgba(t.ink, 0.64), fontSize: 11, textAlign: "left", lineHeight: 1.32 },
    content: { text: spec.subheading },
    animation: fadeIn(130),
  }, 90);

  const cta = node("cta", "BUTTON", PAD, 146, 128, 32, {
    layout: { direction: "row", align: "center", justify: "center", gap: 6 },
    style: {
      backgroundGradient: { type: "LINEAR", angle: 90, stops: [{ offset: 0, color: t.accent }, { offset: 1, color: t.accentDark }] },
      borderRadius: 9999,
      shadow: { enabled: true, x: 0, y: 6, blur: 14, spread: -4, color: rgba(t.accent, 0.5) },
    },
    interaction: { onClick: { type: "OPEN_PRODUCT", target: "{{product.id}}" } },
    animation: fadeIn(200),
    children: [
      node("cta-tx", "TEXT", 0, 0, 92, 14, { style: { color: "#FFFFFF", fontSize: 11, fontWeight: 700 }, content: { label: spec.cta } }),
      node("cta-ic", "ICON", 0, 0, 13, 13, { style: { color: "#FFFFFF", fontSize: 13 }, content: { icon: "ArrowForward" } }),
    ],
  }, 100);

  const design = {
    schemaVersion: 2,
    id: spec.slug,
    name: spec.name,
    category: spec.category,
    status: "DRAFT",
    designTokens: {
      colors: { accent: t.accent, ink: t.ink, muted: rgba(t.ink, 0.6), onBrand: "#FFFFFF" },
      radius: { sm: 8, md: 14, lg: 18, pill: 9999 },
    },
    // Wide, softly tinted wash — light on the copy side, richer behind the visual.
    canvas: {
      width: CANVAS_W,
      height: CANVAS_H,
      background: { type: "GRADIENT", gradient: { type: "LINEAR", angle: 105, stops: [{ offset: 0, color: t.tintSoft }, { offset: 1, color: t.tintTop }] } },
    },
    timeline: { durationMs: 3000 },
    elements: [
      ...buildBackground(t, spec.motif),
      ...buildHero(t, spec.hero),
      badge, heading, subheading, cta,
    ],
    metadata: { createdAt: now, updatedAt: now, source: "SHOPROOM_TEMPLATE" },
  };
  return NotificationDesignSchema.parse(design);
}

// ── The ShopRoom starter templates ───────────────────────────────────────────────

const SPECS: TemplateSpec[] = [
  { slug: "new-arrival-classic", name: "New Arrival Classic", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "purple", motif: "nature", badge: "New Arrival", badgeIcon: "AutoAwesome", heading: "New Arrival!", subheading: "Fresh collection just landed in store.", hero: { kind: "product" }, cta: "Shop Now" },
  { slug: "new-stock-alert", name: "New Stock Alert", category: "NEW_STOCK", categorySlug: "new-stock", theme: "green", motif: "nature", badge: "New Stock", badgeIcon: "Inventory2", heading: "New Stock In", subheading: "Latest products, freshly added today.", hero: { kind: "product" }, cta: "Explore" },
  { slug: "restock-back", name: "Back in Stock", category: "RESTOCK", categorySlug: "restock", theme: "blue", motif: "nature", badge: "Restock", badgeIcon: "Replay", heading: "It's Back!", subheading: "Your favourite item is in stock again.", hero: { kind: "product" }, cta: "Grab Yours" },
  { slug: "limited-stock", name: "Limited Stock", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "amber", motif: "nature", badge: "Limited Stock", badgeIcon: "HourglassBottom", heading: "Almost Gone", subheading: "Only a few left — order before it sells out.", hero: { kind: "product", stock: "12" }, cta: "Buy Now" },
  { slug: "big-sale", name: "Big Sale", category: "SALE", categorySlug: "sale", theme: "pink", motif: "sale", badge: "Sale", badgeIcon: "Sell", heading: "Big Sale Is On", subheading: "Great deals across your favourite picks.", hero: { kind: "offer", percent: "50%" }, cta: "Shop Sale" },
  { slug: "flash-sale", name: "Flash Sale", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "red", motif: "flash", badge: "Flash Sale", badgeIcon: "FlashOn", heading: "Flash Sale!", subheading: "Ends tonight — grab it before time runs out.", hero: { kind: "offer", percent: "70%" }, cta: "Shop Now" },
  { slug: "special-offer", name: "Special Offer", category: "OFFER", categorySlug: "offer", theme: "violet", motif: "gift", badge: "Special Offer", badgeIcon: "LocalOffer", heading: "Just For You", subheading: "An exclusive offer, reserved for you.", hero: { kind: "icon", icon: "CardGiftcard" }, cta: "Claim Offer" },
  { slug: "upcoming-event", name: "Upcoming Event", category: "EVENT", categorySlug: "event", theme: "teal", motif: "event", badge: "Event", badgeIcon: "Event", heading: "You're Invited", subheading: "25 May, 6:00 PM — live on ShopRoom.", hero: { kind: "icon", icon: "Celebration" }, cta: "Join Event" },
  { slug: "important-announcement", name: "Important Announcement", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "blue", motif: "announce", badge: "Announcement", badgeIcon: "Campaign", heading: "A Quick Update", subheading: "Something important from your shop.", hero: { kind: "icon", icon: "Notifications" }, cta: "Read More" },
  { slug: "cart-reminder", name: "Cart Reminder", category: "REMINDER", categorySlug: "reminder", theme: "amber", motif: "reminder", badge: "Reminder", badgeIcon: "Notifications", heading: "Still Waiting", subheading: "You left something in your cart.", hero: { kind: "icon", icon: "Assignment" }, cta: "View Cart" },
  { slug: "custom-blank", name: "Your Message", category: "CUSTOM", categorySlug: "custom", theme: "slate", motif: "custom", badge: "Custom", badgeIcon: "Tune", heading: "Your Message", subheading: "Design it your way. Say it your way.", hero: { kind: "upload" }, cta: "Customise" },
];

export const TEMPLATES = SPECS.map((spec) => ({
  slug: spec.slug,
  name: spec.name,
  categorySlug: spec.categorySlug,
  build: () => buildTemplate(spec),
}));
