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

/**
 * Average advance width of the CTA label at 11px/700, plus the pill's own
 * padding, arrow icon and gap. Used to size the button to its text.
 */
const CTA_CHAR_W = 6.2;
const CTA_CHROME = 46;

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
  plum: { tintTop: "#F6DCF6", tintSoft: "#FEF8FE", accent: "#86198F", accentDark: "#701A75", ink: "#4A044E" },
  violet: { tintTop: "#EBDEFE", tintSoft: "#FCF9FF", accent: "#7C3AED", accentDark: "#6D28D9", ink: "#3B0F70" },
  pink: { tintTop: "#FBDCEA", tintSoft: "#FFF8FC", accent: "#DB2777", accentDark: "#BE185D", ink: "#600A32" },
  rose: { tintTop: "#FBDDE4", tintSoft: "#FFF8FA", accent: "#BE123C", accentDark: "#9F1239", ink: "#4C0519" },
  red: { tintTop: "#FBDCD8", tintSoft: "#FFF8F6", accent: "#DC2626", accentDark: "#B91C1C", ink: "#6B1210" },
  orange: { tintTop: "#FCE4CE", tintSoft: "#FFFAF4", accent: "#EA580C", accentDark: "#C2410C", ink: "#431407" },
  amber: { tintTop: "#FCEFD6", tintSoft: "#FFFCF5", accent: "#D97706", accentDark: "#B45309", ink: "#5A3406" },
  sand: { tintTop: "#F2E3D2", tintSoft: "#FEFAF5", accent: "#92400E", accentDark: "#78350F", ink: "#3B1C05" },
  lime: { tintTop: "#E7F3CE", tintSoft: "#FBFEF4", accent: "#65A30D", accentDark: "#4D7C0F", ink: "#1A2E05" },
  green: { tintTop: "#D8F2E0", tintSoft: "#F7FDF9", accent: "#16A34A", accentDark: "#15803D", ink: "#052E16" },
  forest: { tintTop: "#D6EBDC", tintSoft: "#F6FCF8", accent: "#15803D", accentDark: "#166534", ink: "#04240F" },
  teal: { tintTop: "#D7F0EB", tintSoft: "#F6FCFB", accent: "#0D9488", accentDark: "#0F766E", ink: "#0A3D38" },
  cyan: { tintTop: "#D7EFF6", tintSoft: "#F7FDFE", accent: "#0891B2", accentDark: "#0E7490", ink: "#083344" },
  blue: { tintTop: "#DEEBFD", tintSoft: "#F8FBFF", accent: "#2563EB", accentDark: "#1D4ED8", ink: "#0B2E6B" },
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

/**
 * Background composition families. Each one is a distinct arrangement, not a
 * recolour of another — with only eight, a 60-template catalog reused every
 * backdrop six to ten times and the whole shelf read as one design.
 */
type Motif =
  | "nature" | "sale" | "flash" | "gift" | "event" | "announce" | "reminder" | "custom"
  | "botanical" | "geometric" | "orbit" | "waves" | "confetti" | "spotlight"
  | "grid" | "arch" | "scatter" | "frame";

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
    case "botanical":
      back.push(
        deco("bg-monstera", "monstera", -40, -30, 116, 112, { color: A, opacity: 0.2, z: 8, rotation: -20 }),
        deco("bg-palm", "palm", 316, -26, 116, 102, { color: A, opacity: 0.18, z: 8, rotation: 16 }),
        deco("bg-fern", "fern", -26, 104, 74, 104, { color: A, opacity: 0.18, z: 10, rotation: -10 }),
        deco("bg-grass", "grass", 300, 148, 116, 56, { color: A, opacity: 0.16, z: 10 }),
      );
      break;
    case "geometric":
      back.push(
        deco("bg-hex1", "hexagon", -26, 20, 78, 78, { color: A, opacity: 0.14, z: 8 }),
        deco("bg-hex2", "hexagon", 12, 116, 62, 62, { color: A, opacity: 0.12, z: 8 }),
        deco("bg-tri", "triangle", 208, 12, 58, 54, { color: A, opacity: 0.2, z: 10, rotation: 14 }),
        deco("bg-diamond", "diamond", 352, 130, 58, 58, { color: A, opacity: 0.16, z: 10, rotation: 12 }),
      );
      break;
    case "orbit":
      back.push(
        deco("bg-orbit1", "ring", 214, -18, 184, 184, { color: A, opacity: 0.18, z: 8 }),
        deco("bg-orbit2", "ring", 244, 12, 124, 124, { color: A, opacity: 0.14, z: 8 }),
        deco("bg-orbit3", "ring", -40, 66, 108, 108, { color: A, opacity: 0.14, z: 8 }),
      );
      break;
    case "waves":
      back.push(
        deco("bg-wave1", "wave", -28, 44, 210, 42, { color: A, opacity: 0.14, z: 8 }),
        deco("bg-wave2", "wave", 160, 96, 230, 44, { color: A, opacity: 0.16, z: 8 }),
        deco("bg-wave3", "wave", -18, 150, 220, 42, { color: A, opacity: 0.12, z: 8 }),
      );
      break;
    case "confetti":
      back.push(
        deco("bg-confetti1", "confetti", 250, -26, 140, 140, { opacity: 0.85, z: 100 }),
        deco("bg-confetti2", "confetti", -34, -18, 120, 120, { opacity: 0.65, z: 100 }),
        deco("bg-star", "star", 210, 26, 20, 20, { color: "#F59E0B", opacity: 0.85, z: 110 }),
      );
      break;
    case "spotlight":
      back[0] = deco("bg-glow", "glow", 208, -18, 208, 208, { color: A, opacity: 0.44, z: 4 });
      back.push(
        deco("bg-pool", "spotlight", 216, 8, 180, 180, { color: "#FFFFFF", opacity: 0.5, z: 6 }),
        deco("bg-rays", "light-ray", 240, -44, 132, 184, { color: "#FFFFFF", opacity: 0.34, z: 8 }),
      );
      break;
    case "grid":
      back.push(
        deco("bg-dots1", "dots", -14, 14, 58, 58, { color: A, opacity: 0.18, z: 8 }),
        deco("bg-dots2", "dots", -14, 132, 58, 58, { color: A, opacity: 0.14, z: 8 }),
        deco("bg-dots3", "dots", 348, 14, 58, 58, { color: A, opacity: 0.18, z: 8 }),
        deco("bg-rule", "dashed-line", 206, 176, 176, 8, { color: A, opacity: 0.18, z: 10 }),
      );
      break;
    case "arch":
      back.push(
        deco("bg-arch1", "semicircle", 224, 16, 164, 164, { color: A, opacity: 0.14, z: 8 }),
        deco("bg-arch2", "semicircle", 250, 44, 112, 112, { color: A, opacity: 0.12, z: 8 }),
        deco("bg-quarter", "quarter-circle", -30, 128, 80, 80, { color: A, opacity: 0.14, z: 8, rotation: 180 }),
      );
      break;
    case "scatter":
      back.push(
        deco("bg-bubble1", "bubble", 336, -18, 78, 78, { color: A, opacity: 0.24, z: 8 }),
        deco("bg-bubble2", "bubble", 214, 122, 58, 58, { color: A, opacity: 0.2, z: 8 }),
        deco("bg-bubble3", "bubble", -24, 34, 66, 66, { color: A, opacity: 0.18, z: 8 }),
        deco("bg-bubble4", "bubble", 28, 142, 46, 46, { color: A, opacity: 0.16, z: 8 }),
      );
      break;
    case "frame":
      back.push(
        deco("bg-frame", "frame", 214, 16, 176, 168, { color: A, opacity: 0.2, z: 8 }),
        deco("bg-cross", "cross", 202, 150, 34, 34, { color: A, opacity: 0.22, z: 10, rotation: 12 }),
        deco("bg-hairline", "dashed-line", 22, 42, 170, 6, { color: A, opacity: 0.16, z: 10 }),
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

  // 54 tall, not 50: two lines at 23px/1.12 need 51.5, so a two-line headline
  // ("Everything On Sale") sat 1.5px proud of its own box.
  const heading = node("heading", "TEXT", PAD, 54, TEXT_W, 54, {
    style: { color: t.ink, fontSize: 23, fontWeight: 800, textAlign: "left", lineHeight: 1.12, letterSpacing: -0.3 },
    content: { text: spec.heading },
    animation: fadeIn(70),
  }, 90);

  // Likewise 30, not 28 — two lines at 11px/1.32 need 29.
  const subheading = node("subheading", "TEXT", PAD, 112, TEXT_W, 30, {
    style: { color: rgba(t.ink, 0.64), fontSize: 11, textAlign: "left", lineHeight: 1.32 },
    content: { text: spec.subheading },
    animation: fadeIn(130),
  }, 90);

  // The label sizes the pill, rather than every pill being a fixed 128px.
  // "Continue Shopping" needs ~100px of text; in the old 92px text box it
  // wrapped to two lines and the pill clipped the second one in half.
  // nowrap makes that failure impossible for any future label too.
  const ctaTextW = Math.ceil(spec.cta.length * CTA_CHAR_W);
  const ctaW = Math.min(TEXT_W, ctaTextW + CTA_CHROME);

  const cta = node("cta", "BUTTON", PAD, 148, ctaW, 32, {
    layout: { direction: "row", align: "center", justify: "center", gap: 6 },
    style: {
      backgroundGradient: { type: "LINEAR", angle: 90, stops: [{ offset: 0, color: t.accent }, { offset: 1, color: t.accentDark }] },
      borderRadius: 9999,
      shadow: { enabled: true, x: 0, y: 6, blur: 14, spread: -4, color: rgba(t.accent, 0.5) },
    },
    interaction: { onClick: { type: "OPEN_PRODUCT", target: "{{product.id}}" } },
    animation: fadeIn(200),
    children: [
      node("cta-tx", "TEXT", 0, 0, ctaTextW, 14, {
        style: { color: "#FFFFFF", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" },
        content: { label: spec.cta },
      }),
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
  { slug: "new-arrival-classic", name: "New Arrival Classic", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "purple", motif: "botanical", badge: "New Arrival", badgeIcon: "AutoAwesome", heading: "New Arrival!", subheading: "Fresh collection just landed in store.", hero: { kind: "product" }, cta: "Shop Now" },
  { slug: "new-stock-alert", name: "New Stock Alert", category: "NEW_STOCK", categorySlug: "new-stock", theme: "plum", motif: "grid", badge: "New Stock", badgeIcon: "Inventory2", heading: "New Stock In", subheading: "Latest products, freshly added today.", hero: { kind: "product" }, cta: "Explore" },
  { slug: "restock-back", name: "Back in Stock", category: "RESTOCK", categorySlug: "restock", theme: "violet", motif: "orbit", badge: "Restock", badgeIcon: "Replay", heading: "It's Back!", subheading: "Your favourite item is in stock again.", hero: { kind: "product" }, cta: "Grab Yours" },
  { slug: "limited-stock", name: "Limited Stock", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "pink", motif: "flash", badge: "Limited Stock", badgeIcon: "HourglassBottom", heading: "Almost Gone", subheading: "Only a few left — order before it sells out.", hero: { kind: "product", stock: "12" }, cta: "Buy Now" },
  { slug: "big-sale", name: "Big Sale", category: "SALE", categorySlug: "sale", theme: "rose", motif: "sale", badge: "Sale", badgeIcon: "Sell", heading: "Big Sale Is On", subheading: "Great deals across your favourite picks.", hero: { kind: "offer", percent: "50%" }, cta: "Shop Sale" },
  { slug: "flash-sale", name: "Flash Sale", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "red", motif: "flash", badge: "Flash Sale", badgeIcon: "FlashOn", heading: "Flash Sale!", subheading: "Ends tonight — grab it before time runs out.", hero: { kind: "offer", percent: "70%" }, cta: "Shop Now" },
  { slug: "special-offer", name: "Special Offer", category: "OFFER", categorySlug: "offer", theme: "orange", motif: "gift", badge: "Special Offer", badgeIcon: "LocalOffer", heading: "Just For You", subheading: "An exclusive offer, reserved for you.", hero: { kind: "icon", icon: "CardGiftcard" }, cta: "Claim Offer" },
  { slug: "upcoming-event", name: "Upcoming Event", category: "EVENT", categorySlug: "event", theme: "amber", motif: "event", badge: "Event", badgeIcon: "Event", heading: "You're Invited", subheading: "25 May, 6:00 PM — live on ShopRoom.", hero: { kind: "icon", icon: "Celebration" }, cta: "Join Event" },
  { slug: "important-announcement", name: "Important Announcement", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "sand", motif: "announce", badge: "Announcement", badgeIcon: "Campaign", heading: "A Quick Update", subheading: "Something important from your shop.", hero: { kind: "icon", icon: "Notifications" }, cta: "Read More" },
  { slug: "cart-reminder", name: "Cart Reminder", category: "REMINDER", categorySlug: "reminder", theme: "lime", motif: "reminder", badge: "Reminder", badgeIcon: "Notifications", heading: "Still Waiting", subheading: "You left something in your cart.", hero: { kind: "icon", icon: "Assignment" }, cta: "View Cart" },
  { slug: "custom-blank", name: "Your Message", category: "CUSTOM", categorySlug: "custom", theme: "green", motif: "custom", badge: "Custom", badgeIcon: "Tune", heading: "Your Message", subheading: "Design it your way. Say it your way.", hero: { kind: "upload" }, cta: "Customise" },

  // ── New Arrival ────────────────────────────────────────────────────────────
  { slug: "new-arrival-drop", name: "Weekend Drop", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "forest", motif: "arch", badge: "Weekend Drop", badgeIcon: "NewReleases", heading: "Weekend Drop", subheading: "Exciting new looks, just for you.", hero: { kind: "product" }, cta: "Explore Now" },
  { slug: "new-arrival-season", name: "Season Launch", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "teal", motif: "spotlight", badge: "New Season", badgeIcon: "Spa", heading: "New Season In", subheading: "The season's picks have arrived.", hero: { kind: "product" }, cta: "See Range" },
  { slug: "new-arrival-first-look", name: "First Look", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "cyan", motif: "scatter", badge: "First Look", badgeIcon: "Visibility", heading: "First Look", subheading: "Be the first to see what's new.", hero: { kind: "icon", icon: "AutoAwesome" }, cta: "Take a Look" },
  { slug: "new-arrival-fresh", name: "Fresh Picks", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "blue", motif: "frame", badge: "Fresh", badgeIcon: "LocalMall", heading: "Fresh Picks", subheading: "Handpicked additions to the shelf.", hero: { kind: "product" }, cta: "Browse" },
  { slug: "new-arrival-premium", name: "Premium Launch", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "slate", motif: "nature", badge: "Premium", badgeIcon: "WorkspacePremium", heading: "Premium Range", subheading: "Crafted pieces, now in store.", hero: { kind: "product" }, cta: "Discover" },

  // ── New Stock ──────────────────────────────────────────────────────────────
  { slug: "new-stock-shelf", name: "Shelf Refill", category: "NEW_STOCK", categorySlug: "new-stock", theme: "purple", motif: "geometric", badge: "Restocked", badgeIcon: "Inventory2", heading: "Shelves Filled", subheading: "New batch unpacked and ready.", hero: { kind: "product" }, cta: "Shop Now" },
  { slug: "new-stock-daily", name: "Daily Stock", category: "NEW_STOCK", categorySlug: "new-stock", theme: "plum", motif: "waves", badge: "Today", badgeIcon: "CalendarMonth", heading: "Today's Stock", subheading: "Fresh arrivals added this morning.", hero: { kind: "product" }, cta: "View All" },
  { slug: "new-stock-bulk", name: "Bulk Available", category: "NEW_STOCK", categorySlug: "new-stock", theme: "violet", motif: "scatter", badge: "Bulk", badgeIcon: "LocalShipping", heading: "Bulk Ready", subheading: "Large quantities now available.", hero: { kind: "icon", icon: "Inventory2" }, cta: "Enquire" },
  { slug: "new-stock-trending", name: "Trending Stock", category: "NEW_STOCK", categorySlug: "new-stock", theme: "pink", motif: "nature", badge: "Trending", badgeIcon: "TrendingUp", heading: "Trending Now", subheading: "What everyone is picking up today.", hero: { kind: "product" }, cta: "See Why" },

  // ── Restock ────────────────────────────────────────────────────────────────
  { slug: "restock-favourite", name: "Favourite Restocked", category: "RESTOCK", categorySlug: "restock", theme: "rose", motif: "waves", badge: "Restocked", badgeIcon: "Favorite", heading: "Back Again", subheading: "The one you asked for is back.", hero: { kind: "product" }, cta: "Get It" },
  { slug: "restock-limited-run", name: "Limited Rerun", category: "RESTOCK", categorySlug: "restock", theme: "red", motif: "gift", badge: "Rerun", badgeIcon: "Autorenew", heading: "Second Chance", subheading: "A short rerun — same piece, back briefly.", hero: { kind: "product", stock: "8" }, cta: "Claim It" },
  { slug: "restock-waitlist", name: "Waitlist Ready", category: "RESTOCK", categorySlug: "restock", theme: "orange", motif: "botanical", badge: "Waitlist", badgeIcon: "CheckCircleOutlined", heading: "Your Turn", subheading: "You waited — it's ready for you now.", hero: { kind: "icon", icon: "CheckCircleOutlined" }, cta: "Order Now" },
  { slug: "restock-bestseller", name: "Bestseller Back", category: "RESTOCK", categorySlug: "restock", theme: "amber", motif: "arch", badge: "Bestseller", badgeIcon: "Star", heading: "Bestseller Back", subheading: "Our most-loved pick has returned.", hero: { kind: "product" }, cta: "Shop It" },

  // ── Limited Stock ──────────────────────────────────────────────────────────
  { slug: "limited-hurry", name: "Hurry Up", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "sand", motif: "geometric", badge: "Limited Stock", badgeIcon: "HourglassBottom", heading: "Hurry Up!", subheading: "Only a few items left in stock.", hero: { kind: "product", stock: "10" }, cta: "Grab Now" },
  { slug: "limited-last-few", name: "Last Few", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "lime", motif: "spotlight", badge: "Last Few", badgeIcon: "LocalFireDepartment", heading: "Last Few Left", subheading: "Selling fast — don't wait too long.", hero: { kind: "product", stock: "5" }, cta: "Buy Now" },
  { slug: "limited-final-call", name: "Final Call", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "green", motif: "orbit", badge: "Final Call", badgeIcon: "AccessTime", heading: "Final Call", subheading: "Last pieces before we close this line.", hero: { kind: "product", stock: "3" }, cta: "Order Now" },
  { slug: "limited-one-left", name: "Only One Left", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "forest", motif: "sale", badge: "One Left", badgeIcon: "Whatshot", heading: "Just One Left", subheading: "A single piece remains in store.", hero: { kind: "product", stock: "1" }, cta: "Claim It" },

  // ── Sale ───────────────────────────────────────────────────────────────────
  { slug: "sale-mega", name: "Mega Sale", category: "SALE", categorySlug: "sale", theme: "teal", motif: "confetti", badge: "Mega Sale", badgeIcon: "Sell", heading: "Mega Sale", subheading: "Our biggest markdown of the season.", hero: { kind: "offer", percent: "60%" }, cta: "Shop Sale" },
  { slug: "sale-clearance", name: "Clearance", category: "SALE", categorySlug: "sale", theme: "cyan", motif: "waves", badge: "Clearance", badgeIcon: "Discount", heading: "Clearance On", subheading: "Everything must go this week.", hero: { kind: "offer", percent: "40%" }, cta: "Shop Now" },
  { slug: "sale-weekend", name: "Weekend Sale", category: "SALE", categorySlug: "sale", theme: "blue", motif: "scatter", badge: "Weekend", badgeIcon: "CalendarMonth", heading: "Weekend Sale", subheading: "Two days only, across the store.", hero: { kind: "offer", percent: "30%" }, cta: "Grab Deals" },
  { slug: "sale-buy-one", name: "Buy One Get One", category: "SALE", categorySlug: "sale", theme: "slate", motif: "geometric", badge: "BOGO", badgeIcon: "Redeem", heading: "Buy 1 Get 1", subheading: "Pick two, pay for one. This week only.", hero: { kind: "icon", icon: "Redeem" }, cta: "Shop BOGO" },
  { slug: "sale-festive", name: "Festive Sale", category: "SALE", categorySlug: "sale", theme: "purple", motif: "flash", badge: "Festive", badgeIcon: "Celebration", heading: "Festive Sale", subheading: "Celebrate with savings across the store.", hero: { kind: "offer", percent: "45%" }, cta: "Celebrate" },

  // ── Flash Sale ─────────────────────────────────────────────────────────────
  { slug: "flash-24-hours", name: "24 Hour Flash", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "plum", motif: "spotlight", badge: "24 Hours", badgeIcon: "AccessTime", heading: "24 Hours Only", subheading: "One day. One price. Then it's gone.", hero: { kind: "offer", percent: "50%" }, cta: "Shop Now" },
  { slug: "flash-midnight", name: "Midnight Flash", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "violet", motif: "confetti", badge: "Tonight", badgeIcon: "Bolt", heading: "Ends Midnight", subheading: "Grab it before the clock runs out.", hero: { kind: "offer", percent: "65%" }, cta: "Shop the Sale" },
  { slug: "flash-lightning", name: "Lightning Deal", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "pink", motif: "geometric", badge: "Lightning", badgeIcon: "FlashOn", heading: "Lightning Deal", subheading: "Live for the next few hours only.", hero: { kind: "offer", percent: "55%" }, cta: "Grab It" },
  { slug: "flash-doorbuster", name: "Doorbuster", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "red", motif: "orbit", badge: "Doorbuster", badgeIcon: "LocalFireDepartment", heading: "Doorbuster", subheading: "Limited units at this price.", hero: { kind: "offer", percent: "75%" }, cta: "Shop Fast" },

  // ── Offer ──────────────────────────────────────────────────────────────────
  { slug: "offer-members", name: "Members Only", category: "OFFER", categorySlug: "offer", theme: "red", motif: "confetti", badge: "Members", badgeIcon: "WorkspacePremium", heading: "Members Only", subheading: "A private offer for our room members.", hero: { kind: "icon", icon: "Diamond" }, cta: "Claim Now" },
  { slug: "offer-first-order", name: "First Order Offer", category: "OFFER", categorySlug: "offer", theme: "orange", motif: "orbit", badge: "Welcome", badgeIcon: "CardGiftcard", heading: "Welcome Gift", subheading: "A little something on your first order.", hero: { kind: "icon", icon: "Redeem" }, cta: "Use Offer" },
  { slug: "offer-free-delivery", name: "Free Delivery", category: "OFFER", categorySlug: "offer", theme: "amber", motif: "frame", badge: "Free Delivery", badgeIcon: "LocalShipping", heading: "Free Delivery", subheading: "No delivery charge on orders this week.", hero: { kind: "icon", icon: "LocalShipping" }, cta: "Order Now" },
  { slug: "offer-bundle", name: "Bundle Offer", category: "OFFER", categorySlug: "offer", theme: "sand", motif: "arch", badge: "Bundle", badgeIcon: "LocalMall", heading: "Bundle & Save", subheading: "Better value when you buy together.", hero: { kind: "offer", percent: "25%" }, cta: "See Bundles" },
  { slug: "offer-loyalty", name: "Loyalty Reward", category: "OFFER", categorySlug: "offer", theme: "lime", motif: "scatter", badge: "Reward", badgeIcon: "EmojiEvents", heading: "You've Earned It", subheading: "A reward for shopping with us.", hero: { kind: "icon", icon: "EmojiEvents" }, cta: "Redeem" },

  // ── Event ──────────────────────────────────────────────────────────────────
  { slug: "event-store-opening", name: "Store Opening", category: "EVENT", categorySlug: "event", theme: "green", motif: "confetti", badge: "Opening", badgeIcon: "Storefront", heading: "We're Open!", subheading: "Come see the new store this weekend.", hero: { kind: "icon", icon: "Storefront" }, cta: "Get Directions" },
  { slug: "event-live-demo", name: "Live Demo", category: "EVENT", categorySlug: "event", theme: "forest", motif: "spotlight", badge: "Live", badgeIcon: "PlayArrow", heading: "Going Live", subheading: "Join us for a live walkthrough today.", hero: { kind: "icon", icon: "PlayArrow" }, cta: "Join Live" },
  { slug: "event-big-announcement", name: "Big Event", category: "EVENT", categorySlug: "event", theme: "teal", motif: "arch", badge: "Big Event", badgeIcon: "Celebration", heading: "Coming Soon", subheading: "Stay tuned for something exciting.", hero: { kind: "icon", icon: "CardGiftcard" }, cta: "Notify Me" },
  { slug: "event-workshop", name: "Workshop", category: "EVENT", categorySlug: "event", theme: "cyan", motif: "botanical", badge: "Workshop", badgeIcon: "School", heading: "Join the Workshop", subheading: "Learn with us — limited seats available.", hero: { kind: "icon", icon: "School" }, cta: "Book Seat" },
  { slug: "event-anniversary", name: "Anniversary", category: "EVENT", categorySlug: "event", theme: "blue", motif: "orbit", badge: "Anniversary", badgeIcon: "Celebration", heading: "We Turn 5", subheading: "Thank you for shopping with us.", hero: { kind: "icon", icon: "EmojiEvents" }, cta: "Celebrate" },

  // ── Announcement ───────────────────────────────────────────────────────────
  { slug: "announce-new-hours", name: "New Hours", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "slate", motif: "grid", badge: "Update", badgeIcon: "Schedule", heading: "New Hours", subheading: "We're open later from this Monday.", hero: { kind: "icon", icon: "Schedule" }, cta: "See Hours" },
  { slug: "announce-new-location", name: "New Location", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "purple", motif: "frame", badge: "Moved", badgeIcon: "LocationOn", heading: "We've Moved", subheading: "Find us at our new address.", hero: { kind: "icon", icon: "LocationOn" }, cta: "Get Directions" },
  { slug: "announce-policy", name: "Policy Update", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "violet", motif: "arch", badge: "Notice", badgeIcon: "Info", heading: "Important Update", subheading: "We have something important to share.", hero: { kind: "icon", icon: "Campaign" }, cta: "Read More" },
  { slug: "announce-thank-you", name: "Thank You", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "rose", motif: "scatter", badge: "Thank You", badgeIcon: "Favorite", heading: "Thank You", subheading: "For being part of our shop family.", hero: { kind: "icon", icon: "Favorite" }, cta: "Say Hi" },
  { slug: "announce-holiday", name: "Holiday Notice", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "orange", motif: "announce", badge: "Holiday", badgeIcon: "WbSunny", heading: "Holiday Notice", subheading: "We'll be closed this Thursday.", hero: { kind: "icon", icon: "CalendarMonth" }, cta: "Details" },

  // ── Reminder ───────────────────────────────────────────────────────────────
  { slug: "reminder-abandoned", name: "Left Behind", category: "REMINDER", categorySlug: "reminder", theme: "rose", motif: "grid", badge: "Reminder", badgeIcon: "ShoppingCart", heading: "Don't Forget!", subheading: "You left something amazing behind.", hero: { kind: "icon", icon: "ShoppingCart" }, cta: "Continue Shopping" },
  { slug: "reminder-offer-ending", name: "Offer Ending", category: "REMINDER", categorySlug: "reminder", theme: "red", motif: "waves", badge: "Ending Soon", badgeIcon: "AccessTime", heading: "Ends Tomorrow", subheading: "Your offer expires in 24 hours.", hero: { kind: "icon", icon: "AccessTime" }, cta: "Use It Now" },
  { slug: "reminder-restock-soon", name: "Coming Back", category: "REMINDER", categorySlug: "reminder", theme: "sand", motif: "scatter", badge: "Soon", badgeIcon: "Autorenew", heading: "Almost Back", subheading: "We'll tell you the moment it lands.", hero: { kind: "icon", icon: "Notifications" }, cta: "Notify Me" },
  { slug: "reminder-payment", name: "Payment Due", category: "REMINDER", categorySlug: "reminder", theme: "lime", motif: "arch", badge: "Payment", badgeIcon: "CreditCard", heading: "Payment Due", subheading: "A quick nudge about your pending order.", hero: { kind: "icon", icon: "Receipt" }, cta: "Pay Now" },

  // ── Custom ─────────────────────────────────────────────────────────────────
  { slug: "custom-photo", name: "Photo First", category: "CUSTOM", categorySlug: "custom", theme: "sand", motif: "frame", badge: "Your Photo", badgeIcon: "Image", heading: "Your Photo Here", subheading: "Drop in an image and make it yours.", hero: { kind: "upload" }, cta: "Add Image" },
  { slug: "custom-minimal", name: "Minimal Note", category: "CUSTOM", categorySlug: "custom", theme: "lime", motif: "grid", badge: "Note", badgeIcon: "EditNote", heading: "A Short Note", subheading: "Say it simply, say it clearly.", hero: { kind: "icon", icon: "EditNote" }, cta: "Read" },
  { slug: "custom-bold", name: "Bold Statement", category: "CUSTOM", categorySlug: "custom", theme: "green", motif: "spotlight", badge: "Bold", badgeIcon: "Campaign", heading: "Make It Loud", subheading: "For the message that cannot be missed.", hero: { kind: "icon", icon: "Campaign" }, cta: "Tell Me More" },
  { slug: "custom-product-spotlight", name: "Product Spotlight", category: "CUSTOM", categorySlug: "custom", theme: "forest", motif: "scatter", badge: "Spotlight", badgeIcon: "Star", heading: "In the Spotlight", subheading: "One product, all the attention.", hero: { kind: "product" }, cta: "See It" },

  // ── Second wave ────────────────────────────────────────────────────────────
  { slug: "new-arrival-capsule", name: "Capsule Collection", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "teal", motif: "orbit", badge: "Capsule", badgeIcon: "Checkroom", heading: "Capsule Range", subheading: "A small collection, carefully chosen.", hero: { kind: "product" }, cta: "View Range" },
  { slug: "new-arrival-handmade", name: "Handmade", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "cyan", motif: "geometric", badge: "Handmade", badgeIcon: "Spa", heading: "Made By Hand", subheading: "Small-batch pieces, made with care.", hero: { kind: "product" }, cta: "Discover" },
  { slug: "new-arrival-preorder", name: "Pre-order Open", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "blue", motif: "botanical", badge: "Pre-order", badgeIcon: "Bookmark", heading: "Pre-order Open", subheading: "Reserve yours before it ships.", hero: { kind: "icon", icon: "Bookmark" }, cta: "Reserve" },

  { slug: "new-stock-morning", name: "Morning Delivery", category: "NEW_STOCK", categorySlug: "new-stock", theme: "slate", motif: "orbit", badge: "Delivered", badgeIcon: "LocalShipping", heading: "Just Delivered", subheading: "This morning's delivery is on the shelf.", hero: { kind: "product" }, cta: "Shop Now" },
  { slug: "new-stock-sizes", name: "All Sizes In", category: "NEW_STOCK", categorySlug: "new-stock", theme: "plum", motif: "arch", badge: "All Sizes", badgeIcon: "Checkroom", heading: "Every Size In", subheading: "Full size run is back on the rack.", hero: { kind: "product" }, cta: "Find Yours" },
  { slug: "new-stock-colours", name: "New Colours", category: "NEW_STOCK", categorySlug: "new-stock", theme: "violet", motif: "grid", badge: "New Colours", badgeIcon: "AutoAwesome", heading: "New Colours", subheading: "Same favourite, fresh shades.", hero: { kind: "product" }, cta: "See Colours" },

  { slug: "restock-popular", name: "Popular Again", category: "RESTOCK", categorySlug: "restock", theme: "pink", motif: "scatter", badge: "Popular", badgeIcon: "TrendingUp", heading: "Back By Demand", subheading: "You asked, we restocked.", hero: { kind: "product" }, cta: "Shop It" },
  { slug: "restock-essential", name: "Essentials Back", category: "RESTOCK", categorySlug: "restock", theme: "rose", motif: "frame", badge: "Essentials", badgeIcon: "Inventory2", heading: "Essentials Back", subheading: "The everyday basics are in again.", hero: { kind: "product" }, cta: "Stock Up" },

  { slug: "limited-today-only", name: "Today Only", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "red", motif: "grid", badge: "Today Only", badgeIcon: "AccessTime", heading: "Today Only", subheading: "Once today ends, so does this.", hero: { kind: "product", stock: "6" }, cta: "Get It" },
  { slug: "limited-exclusive", name: "Exclusive Drop", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "orange", motif: "scatter", badge: "Exclusive", badgeIcon: "Diamond", heading: "Exclusive Drop", subheading: "A handful of pieces, then it's gone.", hero: { kind: "product", stock: "4" }, cta: "Claim Yours" },

  { slug: "sale-end-of-season", name: "End of Season", category: "SALE", categorySlug: "sale", theme: "orange", motif: "grid", badge: "Season End", badgeIcon: "CalendarMonth", heading: "Season Ending", subheading: "Last chance on this season's range.", hero: { kind: "offer", percent: "35%" }, cta: "Shop Now" },
  { slug: "sale-storewide", name: "Storewide Sale", category: "SALE", categorySlug: "sale", theme: "amber", motif: "spotlight", badge: "Storewide", badgeIcon: "Storefront", heading: "Everything On Sale", subheading: "Every shelf, every aisle, this week.", hero: { kind: "offer", percent: "20%" }, cta: "Browse All" },
  { slug: "sale-half-price", name: "Half Price", category: "SALE", categorySlug: "sale", theme: "sand", motif: "sale", badge: "Half Price", badgeIcon: "Percent", heading: "Half Price", subheading: "Selected picks at 50% off.", hero: { kind: "offer", percent: "50%" }, cta: "Shop Half" },

  { slug: "flash-two-hours", name: "Two Hour Deal", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "lime", motif: "orbit", badge: "2 Hours", badgeIcon: "Bolt", heading: "Next 2 Hours", subheading: "A short window at a sharp price.", hero: { kind: "offer", percent: "45%" }, cta: "Grab It" },
  { slug: "flash-early-bird", name: "Early Bird", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "green", motif: "scatter", badge: "Early Bird", badgeIcon: "WbSunny", heading: "Early Bird Deal", subheading: "First hour, best price of the day.", hero: { kind: "offer", percent: "60%" }, cta: "Shop Early" },

  { slug: "offer-refer", name: "Refer a Friend", category: "OFFER", categorySlug: "offer", theme: "forest", motif: "grid", badge: "Refer", badgeIcon: "Share", heading: "Refer & Earn", subheading: "Share the shop, both of you save.", hero: { kind: "icon", icon: "Share" }, cta: "Share Now" },
  { slug: "offer-cashback", name: "Cashback", category: "OFFER", categorySlug: "offer", theme: "teal", motif: "waves", badge: "Cashback", badgeIcon: "AccountBalanceWallet", heading: "Get Cashback", subheading: "Money back on your next order.", hero: { kind: "icon", icon: "AccountBalanceWallet" }, cta: "See Terms" },
  { slug: "offer-birthday", name: "Birthday Offer", category: "OFFER", categorySlug: "offer", theme: "cyan", motif: "gift", badge: "Birthday", badgeIcon: "Celebration", heading: "Happy Birthday", subheading: "A little gift on your special day.", hero: { kind: "icon", icon: "CardGiftcard" }, cta: "Open Gift" },

  { slug: "event-flash-meetup", name: "Meetup", category: "EVENT", categorySlug: "event", theme: "slate", motif: "waves", badge: "Meetup", badgeIcon: "Person", heading: "Come Say Hi", subheading: "An informal meetup at the shop.", hero: { kind: "icon", icon: "Storefront" }, cta: "RSVP" },
  { slug: "event-sale-preview", name: "Sale Preview", category: "EVENT", categorySlug: "event", theme: "purple", motif: "event", badge: "Preview", badgeIcon: "Visibility", heading: "Sale Preview", subheading: "Members get first look tonight.", hero: { kind: "icon", icon: "Visibility" }, cta: "Preview" },
  { slug: "event-festival", name: "Festival Special", category: "EVENT", categorySlug: "event", theme: "plum", motif: "confetti", badge: "Festival", badgeIcon: "Celebration", heading: "Festival Time", subheading: "Celebrate the season with us.", hero: { kind: "icon", icon: "Celebration" }, cta: "See Offers" },

  { slug: "announce-restocking-soon", name: "Restocking Soon", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "plum", motif: "scatter", badge: "Soon", badgeIcon: "Schedule", heading: "Restocking Soon", subheading: "Popular items return next week.", hero: { kind: "icon", icon: "Autorenew" }, cta: "Notify Me" },
  { slug: "announce-delivery-area", name: "Delivery Area", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "pink", motif: "announce", badge: "Delivery", badgeIcon: "LocalShipping", heading: "We Deliver Here", subheading: "Now delivering to your area.", hero: { kind: "icon", icon: "LocalShipping" }, cta: "Check Area" },
  { slug: "announce-new-payment", name: "New Payment", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "red", motif: "frame", badge: "Payments", badgeIcon: "CreditCard", heading: "Pay Your Way", subheading: "More payment options at checkout.", hero: { kind: "icon", icon: "CreditCard" }, cta: "Learn More" },

  { slug: "reminder-wishlist", name: "Wishlist Nudge", category: "REMINDER", categorySlug: "reminder", theme: "red", motif: "arch", badge: "Wishlist", badgeIcon: "Favorite", heading: "Still Wishing?", subheading: "Something on your list is in stock.", hero: { kind: "product" }, cta: "View List" },
  { slug: "reminder-loyalty-points", name: "Points Expiring", category: "REMINDER", categorySlug: "reminder", theme: "orange", motif: "spotlight", badge: "Points", badgeIcon: "EmojiEvents", heading: "Points Expiring", subheading: "Use them before the month ends.", hero: { kind: "icon", icon: "EmojiEvents" }, cta: "Spend Points" },
  { slug: "reminder-review", name: "Leave a Review", category: "REMINDER", categorySlug: "reminder", theme: "amber", motif: "reminder", badge: "Review", badgeIcon: "Star", heading: "How Was It?", subheading: "Tell us what you thought.", hero: { kind: "icon", icon: "Star" }, cta: "Rate It" },

  { slug: "custom-quote", name: "Quote Card", category: "CUSTOM", categorySlug: "custom", theme: "lime", motif: "waves", badge: "Quote", badgeIcon: "Campaign", heading: "Say Something", subheading: "A line worth reading twice.", hero: { kind: "icon", icon: "EditNote" }, cta: "Read" },
  { slug: "custom-two-tone", name: "Two Tone", category: "CUSTOM", categorySlug: "custom", theme: "forest", motif: "frame", badge: "Design", badgeIcon: "Tune", heading: "Your Design", subheading: "Start bold and shape it your way.", hero: { kind: "upload" }, cta: "Start" },
  { slug: "custom-clean", name: "Clean Slate", category: "CUSTOM", categorySlug: "custom", theme: "teal", motif: "grid", badge: "Blank", badgeIcon: "Edit", heading: "Clean Slate", subheading: "Nothing but space to work with.", hero: { kind: "upload" }, cta: "Begin" },
];

export const TEMPLATES = SPECS.map((spec) => ({
  slug: spec.slug,
  name: spec.name,
  categorySlug: spec.categorySlug,
  build: () => buildTemplate(spec),
}));
