/**
 * prisma/notificationTemplates.ts — ShopRoom starter templates as v2 composition
 * trees. Each template is a COMPLETE full-canvas marketing creative: one
 * continuous tinted gradient (never a flat white lower section), a designed
 * background composition (atmosphere → foliage → product environment →
 * foreground), content laid directly on the composition, and a premium CTA.
 *
 * Standard UI icons are stored as MUI icon names (content.icon) — never inline
 * SVG. Decorative art is referenced by asset id. Layout convention:
 *   node(id, type, x, y, w, h, extra, z)   — children/style/etc. live in extra.
 */

import {
  NotificationDesignSchema,
  type NotificationType,
} from "../src/schemas/notification.schema.js";

const CANVAS_W = 320;
const CANVAS_H = 560;

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
const fadeIn = (delayMs: number) => ({ entry: { type: "FADE_IN", durationMs: 500, delayMs, easing: "easeOut" } });

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
// tintTop → tintSoft is the full-canvas gradient (top saturated → bottom light,
// but always tinted — never #FFFFFF). accent drives badges/buttons/decor tint.

interface Theme { tintTop: string; tintSoft: string; accent: string; accentDark: string; ink: string }

const THEMES: Record<string, Theme> = {
  purple: { tintTop: "#E4DCFB", tintSoft: "#F7F4FF", accent: "#5B47D4", accentDark: "#3A2DB0", ink: "#2E1065" },
  green: { tintTop: "#D3EFDF", tintSoft: "#F1FBF6", accent: "#0F9D6B", accentDark: "#0A7A52", ink: "#08422E" },
  blue: { tintTop: "#D5E6FD", tintSoft: "#F2F7FE", accent: "#2563EB", accentDark: "#1D4ED8", ink: "#0B2E6B" },
  amber: { tintTop: "#FBE9C6", tintSoft: "#FEFAF0", accent: "#D97706", accentDark: "#B45309", ink: "#5A3406" },
  pink: { tintTop: "#FAD5DE", tintSoft: "#FEF4F7", accent: "#E11D48", accentDark: "#BE123C", ink: "#6B0F24" },
  red: { tintTop: "#FBD2CD", tintSoft: "#FEF3F1", accent: "#DC2626", accentDark: "#B91C1C", ink: "#6B1210" },
  violet: { tintTop: "#E5D6FD", tintSoft: "#F8F3FF", accent: "#7C3AED", accentDark: "#6D28D9", ink: "#3B0F70" },
  teal: { tintTop: "#CDECE5", tintSoft: "#F1FAF8", accent: "#0D9488", accentDark: "#0F766E", ink: "#0A3D38" },
  slate: { tintTop: "#E5E8EF", tintSoft: "#F7F8FB", accent: "#475569", accentDark: "#334155", ink: "#1E293B" },
};

// ── Product environment (glow → shadow → pedestal) ───────────────────────────────

function productEnv(t: Theme, cx: number, baseY: number): unknown[] {
  return [
    deco("product-glow", "product-glow", cx - 80, baseY - 132, 160, 160, { color: t.accent, opacity: 0.45, z: 30 }),
    deco("product-shadow", "product-shadow", cx - 48, baseY - 4, 96, 20, { opacity: 0.5, z: 32 }),
    deco("pedestal", "pedestal", cx - 66, baseY - 16, 132, 46, { color: t.accent, opacity: 0.92, z: 34 }),
  ];
}

// ── Hero builders (occupy the upper-middle of the full canvas) ────────────────────

function heroProduct(t: Theme, stock?: string): unknown[] {
  const out: unknown[] = [
    ...productEnv(t, 160, 260),
    node("product-image", "PRODUCT_IMAGE", 104, 146, 112, 118, {
      // Reusable token — never a hardcoded URL. Resolved at render/send time.
      content: { source: "DYNAMIC", variable: "{{product.image}}" },
      image: { fit: "contain", position: "center" },
      animation: fadeIn(200),
    }, 60),
  ];
  if (stock) {
    out.push(node("stock-badge", "CONTAINER", 226, 166, 78, 68, {
      layout: { direction: "column", align: "center", justify: "center", gap: 0 },
      style: { backgroundColor: "#FFFFFF", borderRadius: 14, shadow: { enabled: true, x: 0, y: 8, blur: 18, spread: -6, color: rgba(t.ink, 0.2) } },
      children: [
        node("stock-only", "TEXT", 0, 0, 60, 12, { style: { color: t.ink, fontSize: 9, opacity: 0.7 }, content: { text: "Only" } }),
        node("stock-num", "VARIABLE_TEXT", 0, 0, 60, 24, { style: { color: t.accent, fontSize: 22, fontWeight: 800 }, content: { source: "DYNAMIC", text: stock } }),
        node("stock-left", "TEXT", 0, 0, 60, 12, { style: { color: t.ink, fontSize: 9, opacity: 0.7 }, content: { text: "Left" } }),
      ],
    }, 62));
  }
  return out;
}

function heroOffer(t: Theme, percent: string, countdown = false): unknown[] {
  const cardH = countdown ? 74 : 100;
  const pctSize = countdown ? 34 : 44;
  const out: unknown[] = [
    deco("offer-glow", "product-glow", 54, countdown ? 130 : 142, 212, 120, { color: t.accent, opacity: 0.5, z: 32 }),
    node("offer-card", "CONTAINER", 56, countdown ? 140 : 152, 208, cardH, {
      layout: { direction: "column", align: "center", justify: "center", gap: 2 },
      style: { backgroundGradient: { type: "LINEAR", angle: 150, stops: [{ offset: 0, color: t.accent }, { offset: 1, color: t.accentDark }] }, borderRadius: 18, shadow: { enabled: true, x: 0, y: 14, blur: 26, spread: -6, color: rgba(t.accent, 0.5) } },
      animation: fadeIn(150),
      children: [
        node("offer-up", "TEXT", 0, 0, 160, 14, { style: { color: "#FFFFFF", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", opacity: 0.9 }, content: { text: "Up to" } }),
        node("offer-pct-row", "GROUP", 0, 0, 170, pctSize, {
          layout: { direction: "row", align: "center", justify: "center", gap: 4 },
          children: [
            node("offer-pct", "TEXT", 0, 0, 110, pctSize, { style: { color: "#FFFFFF", fontSize: pctSize, fontWeight: 900 }, content: { text: percent } }),
            node("offer-off", "TEXT", 0, 0, 40, 20, { style: { color: "#FFFFFF", fontSize: 14, fontWeight: 800 }, content: { text: "OFF" } }),
          ],
        }),
      ],
    }, 55),
    node("offer-bolt", "ICON", 244, countdown ? 128 : 140, 30, 30, { style: { color: "#F5A623" }, content: { icon: "FlashOn" } }, 62),
  ];
  if (countdown) {
    const box = (id: string, x: number, label: string, val: string) =>
      node(id, "CONTAINER", x, 226, 76, 56, {
        layout: { direction: "column", align: "center", justify: "center", gap: 0 },
        style: { backgroundColor: "#FFFFFF", borderRadius: 12, shadow: { enabled: true, x: 0, y: 6, blur: 14, spread: -6, color: rgba(t.ink, 0.18) } },
        children: [
          node(id + "-v", "TEXT", 0, 0, 60, 24, { style: { color: t.accent, fontSize: 22, fontWeight: 800 }, content: { text: val } }),
          node(id + "-l", "TEXT", 0, 0, 60, 12, { style: { color: t.ink, fontSize: 9, opacity: 0.7 }, content: { text: label } }),
        ],
      }, 58);
    out.push(box("cd-h", 26, "Hours", "02"), box("cd-m", 122, "Mins", "15"), box("cd-s", 218, "Secs", "48"));
  }
  return out;
}

function heroIcon(t: Theme, icon: string, dateCard?: { date: string; time: string }): unknown[] {
  const out: unknown[] = [
    deco("icon-glow", "product-glow", 100, 142, 120, 120, { color: t.accent, opacity: 0.5, z: 32 }),
    node("hero-circle", "CONTAINER", 110, 152, 100, 100, {
      layout: { direction: "row", align: "center", justify: "center" },
      style: { backgroundColor: rgba(t.accent, 0.14), borderRadius: 9999 },
      animation: fadeIn(150),
      children: [node("hero-icon", "ICON", 0, 0, 48, 48, { style: { color: t.accent, fontSize: 44 }, content: { icon } })],
    }, 55),
  ];
  if (dateCard) {
    out.push(node("date-card", "CONTAINER", 60, 264, 200, 44, {
      layout: { direction: "row", align: "center", justify: "start", gap: 10, padding: 12 },
      style: { backgroundColor: "#FFFFFF", borderRadius: 12, shadow: { enabled: true, x: 0, y: 8, blur: 16, spread: -6, color: rgba(t.ink, 0.16) } },
      children: [
        node("date-icon", "ICON", 0, 0, 18, 18, { style: { color: t.accent }, content: { icon: "Event" } }),
        node("date-lines", "GROUP", 0, 0, 130, 34, {
          layout: { direction: "column", align: "start", justify: "center" },
          children: [
            node("date-d", "TEXT", 0, 0, 130, 16, { style: { color: t.ink, fontSize: 12, fontWeight: 700 }, content: { text: dateCard.date } }),
            node("date-t", "TEXT", 0, 0, 130, 12, { style: { color: t.ink, fontSize: 10, opacity: 0.65 }, content: { text: dateCard.time } }),
          ],
        }),
      ],
    }, 58));
  }
  return out;
}

function heroUpload(t: Theme): unknown[] {
  return [
    deco("upload-glow", "product-glow", 70, 148, 180, 130, { color: t.accent, opacity: 0.4, z: 32 }),
    node("upload-box", "CONTAINER", 56, 156, 208, 116, {
      layout: { direction: "column", align: "center", justify: "center", gap: 8 },
      style: { backgroundColor: "rgba(255,255,255,0.7)", backdropBlur: 8, borderRadius: 16, border: { width: 2, color: rgba(t.accent, 0.4), style: "dashed" } },
      children: [
        node("upload-icon", "ICON", 0, 0, 30, 30, { style: { color: rgba(t.accent, 0.7), fontSize: 30 }, content: { icon: "Image" } }),
        node("upload-text", "TEXT", 0, 0, 160, 16, { style: { color: t.ink, fontSize: 12, fontWeight: 600, opacity: 0.7 }, content: { text: "Add Your Image" } }),
      ],
    }, 55),
  ];
}

// ── Full-canvas background composition per motif ─────────────────────────────────

type Motif = "nature" | "sale" | "flash" | "gift" | "event" | "announce" | "reminder" | "custom";

function buildBackground(t: Theme, motif: Motif): unknown[] {
  const A = t.accent;
  const back: unknown[] = [deco("bg-glow", "glow", 40, 70, 240, 240, { color: A, opacity: 0.5, z: 4 })];
  switch (motif) {
    case "nature":
      back.push(
        deco("bg-cloud-far", "cloud-soft", -50, 26, 200, 84, { color: "#FFFFFF", opacity: 0.55, z: 8 }),
        deco("bg-cloud", "cloud", -26, 48, 156, 78, { color: "#FFFFFF", opacity: 0.9, z: 12 }),
        // Foliage hugs the edges so it frames the product without crowding copy.
        deco("bg-fern-l", "fern", -56, 150, 92, 142, { color: A, opacity: 0.22, z: 14, rotation: -14 }),
        deco("bg-plant-l", "plant", -74, 186, 148, 152, { color: A, opacity: 0.34, z: 20, rotation: -8 }),
        deco("bg-leaf-l", "leaf-sprig", -40, 264, 88, 124, { color: A, opacity: 0.26, z: 24, rotation: 14 }),
        deco("bg-plant-r", "plant", 246, 178, 148, 156, { color: A, opacity: 0.34, z: 20, rotation: 8 }),
        deco("bg-sprig-r", "leaf-sprig", 262, 96, 88, 130, { color: A, opacity: 0.28, z: 16, rotation: 22 }),
        deco("bg-fern-r", "fern", 276, 258, 82, 128, { color: A, opacity: 0.24, z: 24, rotation: 14 }),
        deco("bg-dots", "dots", 272, 214, 48, 48, { color: "#FFFFFF", opacity: 0.4, z: 100 }),
        deco("bg-spark1", "sparkle", 44, 124, 20, 20, { color: "#FFFFFF", opacity: 0.95, z: 120 }),
        deco("bg-spark2", "sparkle", 274, 192, 15, 15, { color: A, opacity: 0.85, z: 120 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.32, z: 130 }),
      );
      break;
    case "sale":
      back.push(
        deco("bg-confetti", "confetti", 176, 34, 130, 130, { opacity: 0.95, z: 16 }),
        deco("bg-ring", "ring", -24, 174, 112, 112, { color: A, opacity: 0.26, z: 14 }),
        deco("bg-particles", "particles", 0, 330, 320, 230, { color: A, opacity: 0.2, z: 12 }),
        deco("bg-spark1", "sparkle", 250, 116, 16, 16, { color: A, opacity: 0.85, z: 120 }),
        deco("bg-spark2", "star", 56, 86, 14, 14, { color: A, opacity: 0.7, z: 120 }),
        deco("bg-ribbon", "ribbon", -30, 214, 130, 62, { color: A, opacity: 0.26, z: 12, rotation: -12 }),
        deco("bg-confetti2", "confetti", -24, 388, 140, 140, { opacity: 0.8, z: 100 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.3, z: 130 }),
      );
      break;
    case "flash":
      back[0] = deco("bg-glow", "glow", 28, 60, 264, 264, { color: A, opacity: 0.62, z: 4 });
      back.push(
        deco("bg-particles", "particles", 0, 0, 320, 560, { color: A, opacity: 0.5, z: 12 }),
        deco("bg-spark1", "sparkle", 248, 106, 18, 18, { color: "#F59E0B", opacity: 0.95, z: 120 }),
        deco("bg-spark2", "sparkle", 56, 150, 14, 14, { color: A, opacity: 0.8, z: 120 }),
        deco("bg-lightning", "lightning", 256, 150, 44, 76, { color: "#F59E0B", opacity: 0.9, z: 26, rotation: 12 }),
        deco("bg-burst", "sale-burst", 232, 42, 96, 96, { color: A, opacity: 0.2, z: 8 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.3, z: 130 }),
      );
      break;
    case "gift":
      back.push(
        deco("bg-ring1", "ring", -30, 56, 122, 122, { color: A, opacity: 0.24, z: 14 }),
        deco("bg-ring2", "ring", 240, 200, 92, 92, { color: A, opacity: 0.22, z: 14 }),
        deco("bg-particles", "particles", 0, 330, 320, 230, { color: A, opacity: 0.22, z: 12 }),
        deco("bg-spark1", "sparkle", 66, 116, 16, 16, { color: A, opacity: 0.85, z: 120 }),
        deco("bg-spark2", "sparkle", 250, 116, 13, 13, { color: "#F59E0B", opacity: 0.8, z: 120 }),
        deco("bg-spark3", "star", 148, 56, 12, 12, { color: A, opacity: 0.6, z: 120 }),
        deco("bg-orb", "gradient-orb", 232, 74, 110, 110, { color: A, opacity: 0.45, z: 10 }),
        deco("bg-rays", "light-ray", 76, -30, 170, 240, { color: "#FFFFFF", opacity: 0.35, z: 6 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.3, z: 130 }),
      );
      break;
    case "event":
      back.push(
        deco("bg-confetti", "confetti", 172, 32, 132, 132, { opacity: 0.95, z: 16 }),
        deco("bg-cloud", "cloud", -22, 50, 150, 78, { color: "#FFFFFF", opacity: 0.65, z: 10 }),
        deco("bg-particles", "particles", 0, 330, 320, 230, { color: A, opacity: 0.22, z: 12 }),
        deco("bg-spark1", "sparkle", 56, 116, 15, 15, { color: A, opacity: 0.8, z: 120 }),
        deco("bg-ribbon", "ribbon", 224, 252, 130, 62, { color: A, opacity: 0.3, z: 12, rotation: 16 }),
        deco("bg-confetti2", "confetti", 28, 396, 150, 150, { opacity: 0.8, z: 100 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.3, z: 130 }),
      );
      break;
    case "announce":
      back.push(
        deco("bg-wave1", "wave", -10, 250, 210, 44, { color: A, opacity: 0.22, z: 14 }),
        deco("bg-wave2", "wave", 120, 350, 220, 44, { color: A, opacity: 0.18, z: 14 }),
        deco("bg-dots", "dots", 250, 56, 60, 60, { color: A, opacity: 0.32, z: 12 }),
        deco("bg-dots2", "dots", 20, 430, 54, 54, { color: A, opacity: 0.22, z: 12 }),
        deco("bg-rays", "light-ray", 80, -30, 160, 230, { color: "#FFFFFF", opacity: 0.3, z: 6 }),
        deco("bg-ring", "ring", -40, 300, 118, 118, { color: A, opacity: 0.2, z: 12 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.3, z: 130 }),
      );
      break;
    case "reminder":
      back.push(
        deco("bg-particles", "particles", 0, 0, 320, 560, { color: A, opacity: 0.4, z: 12 }),
        deco("bg-dots", "dots", 36, 56, 60, 60, { color: A, opacity: 0.3, z: 12 }),
        deco("bg-spark1", "sparkle", 250, 128, 14, 14, { color: A, opacity: 0.7, z: 120 }),
        deco("bg-orb", "gradient-orb", 228, 70, 110, 110, { color: A, opacity: 0.4, z: 10 }),
        deco("bg-wave", "wave", -20, 430, 240, 50, { color: A, opacity: 0.2, z: 14 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.3, z: 130 }),
      );
      break;
    case "custom":
      back[0] = deco("bg-glow", "glow", 40, 70, 240, 240, { color: A, opacity: 0.3, z: 4 });
      back.push(
        deco("bg-ring", "ring", 240, 56, 92, 92, { color: A, opacity: 0.18, z: 14 }),
        deco("bg-dots", "dots", 30, 430, 60, 60, { color: A, opacity: 0.2, z: 12 }),
        deco("bg-arc", "arc", 60, 96, 200, 110, { color: A, opacity: 0.15, z: 10 }),
        deco("bg-vignette", "vignette", 0, 0, 320, 560, { opacity: 0.3, z: 130 }),
      );
      break;
  }
  return back;
}

// ── Feature row (icon chip + text), laid directly on the composition ─────────────

function featureRow(id: string, y: number, t: Theme, icon: string, title: string, subtitle: string) {
  return node(id, "GROUP", 24, y, 272, 40, {
    layout: { direction: "row", align: "center", justify: "start", gap: 12 },
    children: [
      node(id + "-ic", "CONTAINER", 0, 0, 34, 34, {
        layout: { direction: "row", align: "center", justify: "center" },
        style: { backgroundColor: rgba(t.accent, 0.14), borderRadius: 10 },
        children: [node(id + "-icn", "ICON", 0, 0, 18, 18, { style: { color: t.accent, fontSize: 18 }, content: { icon } })],
      }),
      node(id + "-txt", "GROUP", 0, 0, 210, 36, {
        layout: { direction: "column", align: "start", justify: "center", gap: 1 },
        children: [
          node(id + "-t", "TEXT", 0, 0, 210, 16, { style: { color: t.ink, fontSize: 13, fontWeight: 700 }, content: { text: title } }),
          node(id + "-s", "TEXT", 0, 0, 210, 14, { style: { color: rgba(t.ink, 0.6), fontSize: 11 }, content: { text: subtitle } }),
        ],
      }),
    ],
  }, 80);
}

// ── Template spec + builder ────────────────────────────────────────────────────

interface Feature { icon: string; title: string; subtitle: string }
type Hero =
  | { kind: "product"; stock?: string }
  | { kind: "offer"; percent: string; countdown?: boolean }
  | { kind: "icon"; icon: string; dateCard?: { date: string; time: string } }
  | { kind: "upload" };

interface TemplateSpec {
  slug: string; name: string; category: NotificationType; categorySlug: string; theme: keyof typeof THEMES; motif: Motif;
  badge: string; badgeIcon: string; heading: string; subheading: string;
  hero: Hero; features: Feature[]; button: string; footer: string; progress: number;
}

function buildHero(t: Theme, hero: Hero): unknown[] {
  switch (hero.kind) {
    case "product": return heroProduct(t, hero.stock);
    case "offer": return heroOffer(t, hero.percent, hero.countdown);
    case "icon": return heroIcon(t, hero.icon, hero.dateCard);
    case "upload": return heroUpload(t);
  }
}

export function buildTemplate(spec: TemplateSpec) {
  const t = THEMES[spec.theme];
  const now = new Date().toISOString();
  const fillW = Math.round(272 * Math.min(1, Math.max(0, spec.progress)));

  const badge = node("badge", "CONTAINER", 85, 22, 150, 28, {
    layout: { direction: "row", align: "center", justify: "center", gap: 6 },
    style: { backgroundColor: "#FFFFFF", borderRadius: 9999, shadow: { enabled: true, x: 0, y: 4, blur: 12, spread: -4, color: rgba(t.ink, 0.18) } },
    children: [
      node("badge-ic", "ICON", 0, 0, 14, 14, { style: { color: t.accent }, content: { icon: spec.badgeIcon } }),
      node("badge-tx", "TEXT", 0, 0, 110, 14, { style: { color: t.accent, fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }, content: { text: spec.badge } }),
    ],
  }, 100);

  const heading = node("heading", "TEXT", 20, 58, 280, 60, { style: { color: t.ink, fontSize: 26, fontWeight: 800, textAlign: "center", lineHeight: 1.15 }, content: { text: spec.heading }, animation: fadeIn(80) }, 90);
  const subheading = node("subheading", "TEXT", 30, 122, 260, 34, { style: { color: rgba(t.ink, 0.62), fontSize: 13, textAlign: "center", lineHeight: 1.3 }, content: { text: spec.subheading }, animation: fadeIn(140) }, 90);

  const featTop = spec.features.length >= 2 ? 320 : 342;
  const features = spec.features.slice(0, 2).map((f, i) => featureRow(`feat-${i}`, featTop + i * 46, t, f.icon, f.title, f.subtitle));

  const button = node("button", "CONTAINER", 24, 422, 272, 52, {
    layout: { direction: "row", align: "center", justify: "center", gap: 8 },
    style: { backgroundGradient: { type: "LINEAR", angle: 90, stops: [{ offset: 0, color: t.accent }, { offset: 1, color: t.accentDark }] }, borderRadius: 16, shadow: { enabled: true, x: 0, y: 12, blur: 24, spread: -4, color: rgba(t.accent, 0.55) } },
    interaction: { onClick: { type: "OPEN_PRODUCT", target: "{{product.id}}" } },
    animation: fadeIn(260),
    children: [
      node("button-tx", "TEXT", 0, 0, 180, 18, { style: { color: "#FFFFFF", fontSize: 15, fontWeight: 700 }, content: { label: spec.button } }),
      node("button-ic", "ICON", 0, 0, 16, 16, { style: { color: "#FFFFFF" }, content: { icon: "ArrowForward" } }),
    ],
  }, 100);

  const footer = node("footer", "TEXT", 20, 486, 280, 18, { style: { color: t.accent, fontSize: 12, fontWeight: 600, textAlign: "center" }, content: { text: spec.footer } }, 80);
  const track = node("progress-track", "PROGRESS_BAR", 24, 514, 272, 6, { style: { backgroundColor: rgba(t.accent, 0.18), borderRadius: 9999 } }, 80);
  const fill = node("progress-fill", "PROGRESS_BAR", 24, 514, fillW, 6, { style: { backgroundColor: t.accent, borderRadius: 9999 }, content: { text: String(spec.progress) } }, 81);

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
    // Full-canvas continuous tinted gradient — never a flat white lower section.
    canvas: {
      width: CANVAS_W,
      height: CANVAS_H,
      background: { type: "GRADIENT", gradient: { type: "LINEAR", angle: 180, stops: [{ offset: 0, color: t.tintTop }, { offset: 1, color: t.tintSoft }] } },
    },
    elements: [
      ...buildBackground(t, spec.motif),
      ...buildHero(t, spec.hero),
      badge, heading, subheading,
      ...features, button, footer, track, fill,
    ],
    metadata: { createdAt: now, updatedAt: now, source: "SHOPROOM_TEMPLATE" },
  };
  return NotificationDesignSchema.parse(design);
}

// ── The 11 ShopRoom templates ─────────────────────────────────────────────────

const SPECS: TemplateSpec[] = [
  { slug: "new-arrival-classic", name: "New Arrival Classic", category: "NEW_ARRIVAL", categorySlug: "new-arrival", theme: "purple", motif: "nature", badge: "New Arrival", badgeIcon: "AutoAwesome", heading: "New Arrival!", subheading: "Fresh collection just landed", hero: { kind: "product" }, features: [{ icon: "Star", title: "Trendy Styles", subtitle: "Handpicked for you" }, { icon: "Verified", title: "Premium Quality", subtitle: "Comfort & durability" }], button: "Shop Now", footer: "Only a few items left!", progress: 0.2 },
  { slug: "new-stock-alert", name: "New Stock Alert", category: "NEW_STOCK", categorySlug: "new-stock", theme: "green", motif: "nature", badge: "New Stock", badgeIcon: "Inventory2", heading: "New Stock Alert!", subheading: "Check out our latest products.", hero: { kind: "product" }, features: [{ icon: "CheckCircleOutlined", title: "Latest Products", subtitle: "Freshly added" }, { icon: "Sell", title: "Best Prices", subtitle: "Great value for money" }], button: "Explore Now", footer: "Hurry, before they're gone!", progress: 0.35 },
  { slug: "restock-back", name: "Back in Stock", category: "RESTOCK", categorySlug: "restock", theme: "blue", motif: "nature", badge: "Restock", badgeIcon: "Replay", heading: "It's Back!", subheading: "Your favorite items are restocked.", hero: { kind: "product" }, features: [{ icon: "Inventory2", title: "Back in Stock", subtitle: "Limited quantities" }, { icon: "Favorite", title: "Best Sellers", subtitle: "Loved by everyone" }], button: "Grab Yours Now", footer: "Don't miss it again!", progress: 0.5 },
  { slug: "limited-stock", name: "Limited Stock", category: "LIMITED_STOCK", categorySlug: "limited-stock", theme: "amber", motif: "nature", badge: "Limited Stock", badgeIcon: "HourglassBottom", heading: "Limited Stock!", subheading: "Only a few left in stock. Order now!", hero: { kind: "product", stock: "12" }, features: [{ icon: "FlashOn", title: "Almost Gone", subtitle: "Selling fast" }, { icon: "Verified", title: "Secure Yours", subtitle: "Before it's too late" }], button: "Buy Now", footer: "Limited stock remaining!", progress: 0.7 },
  { slug: "big-sale", name: "Big Sale", category: "SALE", categorySlug: "sale", theme: "pink", motif: "sale", badge: "Sale", badgeIcon: "Sell", heading: "Big Sale!", subheading: "Amazing deals on your favorite products.", hero: { kind: "offer", percent: "50%" }, features: [{ icon: "Verified", title: "Top Brands", subtitle: "Best discounts" }, { icon: "FlashOn", title: "Great Savings", subtitle: "Limited time only" }], button: "Shop the Sale", footer: "Sale ends soon!", progress: 0.55 },
  { slug: "flash-sale", name: "Flash Sale", category: "FLASH_SALE", categorySlug: "flash-sale", theme: "red", motif: "flash", badge: "Flash Sale", badgeIcon: "FlashOn", heading: "Flash Sale!", subheading: "Grab incredible deals before time runs out!", hero: { kind: "offer", percent: "70%", countdown: true }, features: [{ icon: "FlashOn", title: "Deal of the Day", subtitle: "Best discounts" }, { icon: "AccessTime", title: "Great Savings", subtitle: "Limited time only" }], button: "Shop Now", footer: "Hurry! Limited time offer!", progress: 0.85 },
  { slug: "special-offer", name: "Special Offer", category: "OFFER", categorySlug: "offer", theme: "violet", motif: "gift", badge: "Special Offer", badgeIcon: "LocalOffer", heading: "Special Offer!", subheading: "Exclusive offers just for you.", hero: { kind: "icon", icon: "CardGiftcard" }, features: [{ icon: "Verified", title: "Exclusive Deals", subtitle: "Handpicked for you" }, { icon: "Star", title: "Extra Benefits", subtitle: "More value" }], button: "Claim Offer", footer: "Don't miss out!", progress: 0.3 },
  { slug: "upcoming-event", name: "Upcoming Event", category: "EVENT", categorySlug: "event", theme: "teal", motif: "event", badge: "Event", badgeIcon: "Event", heading: "Upcoming Event!", subheading: "Something exciting is coming your way.", hero: { kind: "icon", icon: "Celebration", dateCard: { date: "25 May 2025", time: "06:00 PM" } }, features: [{ icon: "Campaign", title: "Live on ShopRoom", subtitle: "Join us online" }], button: "Join the Event", footer: "Mark your calendar!", progress: 0.4 },
  { slug: "important-announcement", name: "Important Announcement", category: "ANNOUNCEMENT", categorySlug: "announcement", theme: "blue", motif: "announce", badge: "Announcement", badgeIcon: "Campaign", heading: "Important Announcement", subheading: "We have an important update for you.", hero: { kind: "icon", icon: "Notifications" }, features: [{ icon: "Verified", title: "Official Update", subtitle: "From ShopRoom" }, { icon: "Campaign", title: "Stay Informed", subtitle: "Important information" }], button: "Read More", footer: "Stay updated with us!", progress: 0.45 },
  { slug: "cart-reminder", name: "Cart Reminder", category: "REMINDER", categorySlug: "reminder", theme: "amber", motif: "reminder", badge: "Reminder", badgeIcon: "Notifications", heading: "Don't Forget!", subheading: "You have something waiting for you.", hero: { kind: "icon", icon: "Assignment" }, features: [{ icon: "HourglassBottom", title: "Pending Items", subtitle: "Complete them now" }, { icon: "Verified", title: "Stay on Track", subtitle: "Don't miss out" }], button: "View Reminder", footer: "A quick reminder!", progress: 0.6 },
  { slug: "custom-blank", name: "Your Message", category: "CUSTOM", categorySlug: "custom", theme: "slate", motif: "custom", badge: "Custom", badgeIcon: "Tune", heading: "Your Message", subheading: "Design it your way. Say it your way.", hero: { kind: "upload" }, features: [{ icon: "CheckCircleOutlined", title: "Fully Editable", subtitle: "Make it unique" }, { icon: "Star", title: "Your Style", subtitle: "Your colors, your way" }], button: "Customize Now", footer: "Make it yours!", progress: 0.5 },
];

export const TEMPLATES = SPECS.map((spec) => ({
  slug: spec.slug,
  name: spec.name,
  categorySlug: spec.categorySlug,
  build: () => buildTemplate(spec),
}));
