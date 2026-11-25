/**
 * prisma/templates/kit.ts — Building blocks shared by every template layout.
 *
 * The canvas is the notification's 2:1 big-picture banner (400×200). Layout
 * convention: node(id, type, x, y, w, h, extra, z) — children, style and the
 * rest live in extra. Children of a container without a layout direction are
 * positioned relative to that container.
 */

import { PHOTOS, type PhotoName } from "./photos.js";

export const FONT = "Poppins";
export const SERIF = "Playfair Display";
export const DISPLAY = "Montserrat";
export const INK = "#17162B";
export const WHITE = "#FFFFFF";
export const BRAND = "#6D28D9";

/** What a layout produces: the canvas colour and the element tree. */
export interface Design {
  background: string;
  elements: unknown[];
}

/** A product shown in a tile (grids, pairs, strips). */
export interface Item {
  photo: PhotoName;
  name: string;
  price: string;
}

type Obj = Record<string, unknown>;
interface Extra {
  style?: Obj;
  layout?: Obj;
  content?: Obj;
  image?: Obj;
  asset?: Obj;
  animation?: Obj;
  interaction?: Obj;
  children?: unknown[];
}

export function node(id: string, type: string, x: number, y: number, w: number, h: number, extra: Extra = {}, z = 50, rotation = 0) {
  return { id, type, frame: { x, y, width: w, height: h, rotation, zIndex: z }, ...extra };
}

/** Entrance animation; an optional looping emphasis starts once it has finished. */
export function enter(type: string, delayMs = 0, attention?: string) {
  return {
    entry: { type, delayMs, durationMs: 600, easing: "easeOut" },
    ...(attention ? { attention: { type: attention, delayMs: delayMs + 900, durationMs: 1600, repeat: "infinite" } } : {}),
  };
}

export function linear(angle: number, stops: [number, string][]) {
  return { type: "LINEAR", angle, stops: stops.map(([offset, color]) => ({ offset, color })) };
}

/** "#RRGGBB" → "r,g,b", for building rgba() scrims from a theme colour. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
export function alpha(hex: string, a: number): string {
  return `rgba(${rgb(hex)},${a})`;
}

/** Left-to-right darkening so light copy reads on any photo. */
export const leftScrim = (hex: string, strong = 0.88) =>
  linear(90, [[0, alpha(hex, strong)], [0.45, alpha(hex, Number((strong * 0.6).toFixed(2)))], [0.78, alpha(hex, 0)]]);
/** Bottom-up darkening for copy that sits along the bottom edge. */
export const bottomScrim = (hex: string) => linear(180, [[0, alpha(hex, 0.3)], [0.8, alpha(hex, 0.92)]]);
/** Fades a side photo into the flat background colour next to it. */
export const fadeFromLeft = (hex: string) => linear(90, [[0, hex], [0.32, alpha(hex, 0)]]);

interface PhotoOpts { position?: string; overlay?: Obj; radius?: number; border?: Obj; shadow?: boolean; z?: number; anim?: Obj }
/**
 * `cc=sample` marks a template's stock photo as a placeholder. The CDN ignores it; the web app looks
 * for it (features/notifications/sampleContent.ts) to warn before a shop sends a banner that still
 * shows a photo that is not its own. A replaced photo has a different URL, so the marker goes with it.
 */
const SAMPLE_MARKER = "cc=sample";

export function photo(id: string, name: PhotoName, x: number, y: number, w: number, h: number, o: PhotoOpts = {}) {
  return node(id, "IMAGE", x, y, w, h, {
    asset: { type: "IMAGE", url: `https://images.unsplash.com/photo-${PHOTOS[name]}?w=900&q=75&auto=format&fit=crop&${SAMPLE_MARKER}`, attribution: { provider: "UNSPLASH" } },
    image: { fit: "cover", position: o.position ?? "center", ...(o.overlay ? { overlay: { gradient: o.overlay, opacity: 1 } } : {}) },
    style: {
      ...(o.radius != null ? { borderRadius: o.radius } : {}),
      ...(o.border ? { border: o.border } : {}),
      ...(o.shadow ? { shadow: { enabled: true, x: 0, y: 8, blur: 20, spread: -6, color: "rgba(15,23,42,0.35)" } } : {}),
    },
    ...(o.anim ? { animation: o.anim } : {}),
  }, o.z ?? 1);
}

export function text(id: string, value: string, x: number, y: number, w: number, h: number, style: Obj, anim?: Obj, z = 60, rotation = 0) {
  return node(id, "TEXT", x, y, w, h, {
    style: { fontFamily: FONT, textAlign: "left", lineHeight: 1.1, ...style },
    content: { text: value },
    ...(anim ? { animation: anim } : {}),
  }, z, rotation);
}

/** A text pill. LABEL rather than TEXT so a border outlines the box, not the glyphs. */
export function pill(id: string, value: string, x: number, y: number, w: number, h: number, style: Obj, anim?: Obj, z = 65, rotation = 0) {
  return node(id, "LABEL", x, y, w, h, {
    style: { fontFamily: FONT, textAlign: "center", lineHeight: 1, ...style },
    content: { text: value },
    ...(anim ? { animation: anim } : {}),
  }, z, rotation);
}

export function rect(id: string, x: number, y: number, w: number, h: number, style: Obj, anim?: Obj, z = 40) {
  return node(id, "RECTANGLE", x, y, w, h, { style, ...(anim ? { animation: anim } : {}) }, z);
}

export function icon(id: string, name: string, x: number, y: number, size: number, color: string, anim?: Obj, z = 60) {
  return node(id, "ICON", x, y, size, size, { style: { color, fontSize: size }, content: { icon: name }, ...(anim ? { animation: anim } : {}) }, z);
}

export const eyebrow = (color: string): Obj => ({ color, fontSize: 9.5, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", opacity: 0.92, whiteSpace: "nowrap" });
export const heading = (color: string, size = 24): Obj => ({ color, fontSize: size, fontWeight: 700, lineHeight: 1.05, letterSpacing: -0.4, verticalAlign: "top" });
export const priceStyle = (color: string, size = 26): Obj => ({ color, fontSize: size, fontWeight: 800, letterSpacing: -0.5, whiteSpace: "nowrap" });
export const mrpStyle = (color: string): Obj => ({ color, fontSize: 12, fontWeight: 500, opacity: 0.7, textDecoration: "line-through", whiteSpace: "nowrap" });

/** Rough rendered width of a bold price, so the MRP can sit right after it. */
export function priceWidth(value: string, size = 26): number {
  return Math.ceil(value.length * size * 0.62);
}

/** A price with its struck-through MRP beside it (the MRP is optional). */
export function priceRow(x: number, y: number, price: string, mrp: string | undefined, color: string, size = 26, delayMs = 300, dir = "SLIDE_UP") {
  const w = priceWidth(price, size);
  return [
    text("price", price, x, y, w + 6, size + 6, priceStyle(color, size), enter(dir, delayMs)),
    ...(mrp ? [text("mrp", mrp, x + w + 8, y + size * 0.4, 70, 16, mrpStyle(color), enter(dir, delayMs))] : []),
  ];
}

/** The shop's name in a pill, top-left unless the layout puts it elsewhere. */
export function shopChip(name: string, x = 14, y = 14, bg = "rgba(255,255,255,0.95)") {
  const w = shopChipWidth(name);
  return node("shop", "CONTAINER", x, y, w, 22, {
    layout: { direction: "row", align: "center", justify: "start", gap: 6, padding: { left: 3, right: 9 } },
    style: { backgroundColor: bg, borderRadius: 9999 },
    animation: enter("FADE_IN"),
    children: [
      pill("shop-initial", name.charAt(0).toUpperCase(), 0, 0, 16, 16, { backgroundColor: BRAND, color: WHITE, fontSize: 8.5, fontWeight: 700, borderRadius: 9999 }),
      text("shop-name", name, 0, 0, w - 34, 14, { color: INK, fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap" }),
    ],
  }, 90);
}
export const shopChipWidth = (name: string) => Math.ceil(name.length * 6.2) + 34;

export type CtaTone = "light" | "dark" | "brand";
const CTA_TONES: Record<CtaTone, { bg: string; fg: string }> = {
  light: { bg: WHITE, fg: INK },
  dark: { bg: INK, fg: WHITE },
  brand: { bg: BRAND, fg: WHITE },
};
export const ctaWidth = (label: string) => Math.ceil(label.length * 6.8) + 34;

/** One call-to-action button. `tone` may also be a custom background colour. */
export function cta(label: string, x: number, y: number, tone: CtaTone | string, delayMs: number, h = 28) {
  const t = tone in CTA_TONES ? CTA_TONES[tone as CtaTone] : { bg: tone, fg: WHITE };
  const w = ctaWidth(label);
  return node("cta", "BUTTON", x, y, w, h, {
    layout: { direction: "row", align: "center", justify: "center" },
    style: { backgroundColor: t.bg, borderRadius: 9999, shadow: { enabled: true, x: 0, y: 4, blur: 12, spread: -4, color: "rgba(15,23,42,0.35)" } },
    interaction: { onClick: { type: "OPEN_PRODUCT", target: "{{product.id}}" } },
    animation: enter("SLIDE_UP", delayMs),
    children: [text("cta-label", label, 0, 0, w - 30, 14, { color: t.fg, fontSize: 11, fontWeight: 600, textAlign: "center", whiteSpace: "nowrap" })],
  }, 95);
}

/** Product tile: photo with a white caption (name + price) along the bottom. */
export function tile(id: string, item: Item, x: number, y: number, w: number, h: number, delayMs: number) {
  // Narrow tiles (collection strips) get a tighter caption so a 9-letter name still fits.
  const pad = w < 90 ? 5 : 8;
  const inner = w - 12 - pad * 2;
  return [
    photo(`${id}-photo`, item.photo, x, y, w, h, { radius: 10, z: 20, anim: enter("SLIDE_UP", delayMs) }),
    node(`${id}-caption`, "CONTAINER", x + 6, y + h - 40, w - 12, 34, {
      layout: { direction: "column", align: "start", justify: "center", gap: 1, padding: { left: pad, right: pad } },
      style: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 7 },
      animation: enter("FADE_IN", delayMs + 200),
      children: [
        text(`${id}-name`, item.name, 0, 0, inner, 12, { color: INK, fontSize: w < 90 ? 8.5 : 9, fontWeight: 600, overflow: "ellipsis" }),
        text(`${id}-price`, item.price, 0, 0, inner, 15, { color: INK, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }),
      ],
    }, 30),
  ];
}

/** Compact tile for dense grids: photo with a one-line "name · price" strip. */
export function miniTile(id: string, item: Item, x: number, y: number, w: number, h: number, delayMs: number) {
  return [
    photo(`${id}-photo`, item.photo, x, y, w, h, { radius: 8, z: 20, anim: enter("ZOOM_IN", delayMs) }),
    node(`${id}-caption`, "CONTAINER", x + 4, y + h - 22, w - 8, 18, {
      layout: { direction: "row", align: "center", justify: "between", gap: 3, padding: { left: 5, right: 5 } },
      style: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 5 },
      animation: enter("FADE_IN", delayMs + 200),
      children: [
        text(`${id}-name`, item.name, 0, 0, w - 53, 11, { color: INK, fontSize: 8, fontWeight: 600, overflow: "ellipsis" }),
        text(`${id}-price`, item.price, 0, 0, 40, 12, { color: INK, fontSize: 9.5, fontWeight: 800, textAlign: "right", whiteSpace: "nowrap" }),
      ],
    }, 30),
  ];
}
