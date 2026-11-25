/**
 * prisma/templates/layouts.ts — The product-banner layouts.
 *
 * Each layout is a function from content (shop, product, prices, photo,
 * colours) to a Design, so one arrangement serves many shops: the catalog in
 * prisma/notificationTemplates.ts calls these with different content.
 * Text lengths in the catalog are kept close to what each layout was sized for.
 */

import type { PhotoName } from "./photos.js";
import {
  DISPLAY, INK, SERIF, WHITE, type CtaTone, type Design, type Item,
  alpha, bottomScrim, cta, ctaWidth, enter, eyebrow, fadeFromLeft, heading, icon,
  leftScrim, linear, miniTile, mrpStyle, node, photo, pill, priceRow, priceStyle,
  priceWidth, rect, shopChip, shopChipWidth, text, tile,
} from "./kit.js";

type Position = "center" | "top" | "bottom" | "left" | "right";

// ── 1. Hero product: full photo, copy on a dark fade ──────────────────────────────
export function hero(c: { shop: string; label: string; name: string; price: string; mrp?: string; cta: string; photo: PhotoName; tint: string; position?: Position }): Design {
  return {
    background: c.tint,
    elements: [
      photo("product-photo", c.photo, 0, 0, 400, 200, { position: c.position ?? "top", overlay: leftScrim(c.tint) }),
      shopChip(c.shop),
      text("label", c.label, 20, 56, 200, 14, eyebrow(WHITE), enter("SLIDE_UP", 100)),
      text("name", c.name, 20, 72, 200, 52, heading(WHITE), enter("SLIDE_UP", 200)),
      ...priceRow(20, 126, c.price, c.mrp, WHITE),
      cta(c.cta, 20, 162, "light", 450),
    ],
  };
}

// ── 2. Price sticker: product on a flat colour, round price badge ─────────────────
export function sticker(c: { shop: string; label: string; name: string; stickerLabel: string; price: string; cta: string; photo: PhotoName; bg: string; ink?: string }): Design {
  const ink = c.ink ?? INK;
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 150, 0, 250, 200, { overlay: fadeFromLeft(c.bg) }),
      shopChip(c.shop),
      text("label", c.label, 20, 58, 180, 14, eyebrow(ink), enter("SLIDE_UP", 100)),
      text("name", c.name, 20, 74, 170, 52, heading(ink), enter("SLIDE_UP", 200)),
      cta(c.cta, 20, 134, ink === INK ? "dark" : "light", 400),
      node("sticker", "CONTAINER", 180, 104, 82, 82, {
        layout: { direction: "column", align: "center", justify: "center", gap: 0 },
        style: { backgroundColor: ink, borderRadius: 9999, shadow: { enabled: true, x: 0, y: 6, blur: 16, spread: -4, color: "rgba(0,0,0,0.35)" } },
        animation: enter("POP", 500, "PULSE"),
        children: [
          text("sticker-label", c.stickerLabel, 0, 0, 70, 12, { color: c.bg, fontSize: 9.5, fontWeight: 500, textAlign: "center" }),
          text("price", c.price, 0, 0, 76, 24, { ...priceStyle(c.bg, 19), textAlign: "center" }),
        ],
      }, 80),
    ],
  };
}

// ── 3. Split card: photo left, clean details panel right ──────────────────────────
export function split(c: { shop: string; discount: string; name: string; spec: string; price: string; mrp?: string; cta: string; photo: PhotoName; panel?: string; ink?: string; accent: string }): Design {
  const ink = c.ink ?? INK;
  const panel = c.panel ?? WHITE;
  return {
    background: panel,
    elements: [
      photo("product-photo", c.photo, 0, 0, 184, 200, { anim: enter("FADE_IN") }),
      shopChip(c.shop, 386 - shopChipWidth(c.shop), 14, alpha(c.accent, 0.1)),
      pill("discount", c.discount, 202, 36, 62, 18, { backgroundColor: "#16A34A", color: WHITE, fontSize: 9.5, fontWeight: 700, borderRadius: 4 }, enter("POP", 200)),
      text("name", c.name, 202, 58, 186, 50, heading(ink, 22), enter("SLIDE_LEFT", 250)),
      text("spec", c.spec, 202, 110, 186, 14, { color: ink, opacity: 0.6, fontSize: 10.5 }, enter("SLIDE_LEFT", 320)),
      ...priceRow(202, 126, c.price, c.mrp, ink, 26, 400, "SLIDE_LEFT"),
      cta(c.cta, 202, 162, c.accent, 550),
    ],
  };
}

// ── 4. Discount burst: photo, starburst %, white price card ───────────────────────
export function burst(c: { shop: string; discount: string; name: string; price: string; mrp?: string; photo: PhotoName; bg: string; burst: string; position?: Position }): Design {
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 0, 0, 400, 200, { position: c.position ?? "center" }),
      shopChip(c.shop),
      node("burst", "CONTAINER", 288, 12, 98, 98, {
        layout: { direction: "column", align: "center", justify: "center", gap: 0 },
        style: { backgroundColor: c.burst, clipShape: "burst" },
        animation: enter("POP", 400, "PULSE"),
        children: [
          text("discount", c.discount, 0, 0, 70, 28, { color: WHITE, fontSize: 24, fontWeight: 800, textAlign: "center" }),
          text("discount-label", "OFF", 0, 0, 50, 13, { color: WHITE, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textAlign: "center" }),
        ],
      }, 80),
      node("price-card", "CONTAINER", 16, 112, 180, 74, {
        style: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 10, shadow: { enabled: true, x: 0, y: 6, blur: 16, spread: -6, color: "rgba(15,23,42,0.25)" } },
        animation: enter("SLIDE_UP", 300),
        children: [
          text("name", c.name, 12, 10, 160, 24, heading(INK, 18)),
          text("price", c.price, 12, 36, priceWidth(c.price, 24) + 6, 30, priceStyle(INK, 24)),
          ...(c.mrp ? [text("mrp", c.mrp, 20 + priceWidth(c.price, 24), 45, 62, 16, mrpStyle(INK))] : []),
        ],
      }, 70),
    ],
  };
}

// ── 5. Two products side by side ──────────────────────────────────────────────────
export function pair(c: { label: string; title: string; cta: string; items: [Item, Item]; bg: string; ink: string; serif?: boolean }): Design {
  return {
    background: c.bg,
    elements: [
      text("label", c.label, 20, 50, 130, 14, eyebrow(c.ink), enter("SLIDE_UP")),
      text("name", c.title, 20, 66, 136, 58, { ...heading(c.ink, 24), ...(c.serif === false ? {} : { fontFamily: SERIF }) }, enter("SLIDE_UP", 100)),
      cta(c.cta, 20, 132, c.ink === WHITE ? "light" : "dark", 300),
      ...tile("item-1", c.items[0], 166, 14, 104, 172, 150),
      ...tile("item-2", c.items[1], 282, 14, 104, 172, 280),
    ],
  };
}

// ── 6. Three-product grid ─────────────────────────────────────────────────────────
export function grid(c: { title: string; link: string; items: [Item, Item, Item]; bg: string; ink?: string; linkColor: string }): Design {
  return {
    background: c.bg,
    elements: [
      text("name", c.title, 16, 14, 240, 26, heading(c.ink ?? WHITE, 18), enter("FADE_IN")),
      text("link", c.link, 276, 18, 108, 18, { color: c.linkColor, fontSize: 11, fontWeight: 600, textAlign: "right" }, enter("FADE_IN", 100)),
      ...tile("item-1", c.items[0], 16, 50, 116, 136, 100),
      ...tile("item-2", c.items[1], 142, 50, 116, 136, 200),
      ...tile("item-3", c.items[2], 268, 50, 116, 136, 300),
    ],
  };
}

// ── 7. Daily rate card: today's prices, row by row ────────────────────────────────
export function rateCard(c: { label: string; name: string; rows: [string, string, string][]; tag: string; photo: PhotoName; bg: string; accent: string }): Design {
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 0, 0, 160, 200, { anim: enter("FADE_IN") }),
      pill("tag", c.tag, 10, 172, 76, 18, { backgroundColor: c.accent, color: c.bg, fontSize: 9, fontWeight: 700, borderRadius: 9999 }, enter("POP", 600)),
      text("label", c.label, 178, 22, 206, 14, eyebrow(WHITE), enter("SLIDE_UP")),
      text("name", c.name, 178, 38, 206, 28, heading(WHITE, 20), enter("SLIDE_UP", 60)),
      ...c.rows.slice(0, 4).map(([item, price, unit], i) =>
        node(`row-${i + 1}`, "CONTAINER", 178, 74 + i * 27, 206, 22, {
          layout: { direction: "row", align: "center", justify: "start", gap: 6 },
          animation: enter("SLIDE_LEFT", 150 + i * 100),
          children: [
            text(`row-${i + 1}-item`, item, 0, 0, 68, 16, { color: WHITE, fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap" }),
            rect(`row-${i + 1}-dots`, 0, 0, 44, 0, { border: { width: 1, color: "rgba(255,255,255,0.35)", style: "dotted" } }),
            text(`row-${i + 1}-price`, price, 0, 0, 38, 16, { color: c.accent, fontSize: 13, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }),
            text(`row-${i + 1}-unit`, unit, 0, 0, 38, 14, { color: WHITE, fontSize: 9, opacity: 0.7, whiteSpace: "nowrap" }),
          ],
        }, 60),
      ),
    ],
  };
}

// ── 8. Combo deal: product + product = one price ──────────────────────────────────
export function combo(c: { label: string; photos: [PhotoName, PhotoName]; comboName: string; priceLabel: string; price: string; saving: string; cta: string; from: string; to: string; soft: string }): Design {
  const ring = { width: 3, color: WHITE, style: "solid" };
  return {
    background: c.to,
    elements: [
      rect("backdrop", 0, 0, 400, 200, { backgroundGradient: linear(135, [[0, c.from], [1, c.to]]) }, undefined, 0),
      text("label", c.label, 20, 18, 250, 14, eyebrow(c.soft), enter("FADE_IN")),
      photo("product-photo", c.photos[0], 20, 50, 84, 84, { radius: 9999, border: ring, z: 30, anim: enter("POP", 100) }),
      text("plus", "+", 108, 74, 24, 34, { color: WHITE, fontSize: 30, fontWeight: 300, textAlign: "center" }, enter("FADE_IN", 300)),
      photo("product-photo-2", c.photos[1], 136, 50, 84, 84, { radius: 9999, border: ring, z: 30, anim: enter("POP", 400) }),
      text("name", c.comboName, 20, 152, 200, 16, { color: WHITE, fontSize: 11, opacity: 0.85 }, enter("FADE_IN", 500)),
      text("price-label", c.priceLabel, 250, 40, 134, 14, { ...eyebrow(WHITE), textAlign: "right" }, enter("FADE_IN", 500)),
      text("price", c.price, 230, 56, 154, 44, { ...priceStyle(WHITE, 36), textAlign: "right" }, enter("POP", 600)),
      pill("saving", c.saving, 300, 104, 84, 20, { backgroundColor: "#FACC15", color: INK, fontSize: 10, fontWeight: 700, borderRadius: 9999 }, enter("SLIDE_UP", 750)),
      cta(c.cta, 384 - ctaWidth(c.cta), 138, "light", 900),
    ],
  };
}

// ── 9. New arrival: ribbon, colours and sizes ─────────────────────────────────────
export function newArrival(c: { shop: string; ribbon: string; name: string; colors: string[]; sizes: string[]; price: string; photo: PhotoName; tint: string; ribbonColor: string; position?: Position }): Design {
  return {
    background: c.tint,
    elements: [
      photo("product-photo", c.photo, 0, 0, 400, 200, { position: c.position ?? "top", overlay: leftScrim(c.tint) }),
      shopChip(c.shop),
      pill("ribbon", c.ribbon, 322, 14, 120, 20, { backgroundColor: c.ribbonColor, color: WHITE, fontSize: 10, fontWeight: 800, letterSpacing: 3 }, enter("FADE_IN", 500), 85, 35),
      text("name", c.name, 20, 54, 200, 52, heading(WHITE), enter("SLIDE_UP", 100)),
      ...c.colors.slice(0, 5).map((color, i) =>
        rect(`colour-${i + 1}`, 20 + i * 18, 112, 13, 13, { backgroundColor: color, borderRadius: 9999, border: { width: 2, color: WHITE, style: "solid" } }, enter("POP", 200 + i * 60), 60),
      ),
      ...c.sizes.slice(0, 6).map((size, i) =>
        pill(`size-${i + 1}`, size, 20 + i * 26, 132, 22, 16, { color: WHITE, fontSize: 9, fontWeight: 600, borderRadius: 3, border: { width: 1, color: "rgba(255,255,255,0.7)", style: "solid" } }, enter("SLIDE_UP", 300)),
      ),
      text("price", c.price, 20, 154, 140, 32, priceStyle(WHITE), enter("SLIDE_UP", 400)),
    ],
  };
}

// ── 10. Low stock: draining stock bar ─────────────────────────────────────────────
export function lowStock(c: { shop: string; label: string; name: string; stock: string; left: number; price: string; cta: string; photo: PhotoName; bg: string }): Design {
  const fill = Math.max(10, Math.round(170 * c.left));
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 192, 0, 208, 200, { overlay: fadeFromLeft(c.bg), anim: enter("FADE_IN") }),
      shopChip(c.shop),
      rect("alert-dot", 20, 52, 8, 8, { backgroundColor: "#DC2626", borderRadius: 9999 }, enter("FADE_IN", 0, "PULSE"), 60),
      text("label", c.label, 34, 49, 150, 14, { ...eyebrow("#DC2626"), fontWeight: 700, opacity: 1 }, enter("FADE_IN")),
      text("name", c.name, 20, 66, 176, 46, heading(INK, 21), enter("SLIDE_UP", 100)),
      rect("stock-track", 20, 116, 170, 7, { backgroundColor: "#E2E0E8", borderRadius: 9999 }, enter("FADE_IN", 200)),
      rect("stock-fill", 20, 116, fill, 7, { backgroundGradient: linear(90, [[0, "#F97316"], [1, "#DC2626"]]), borderRadius: 9999 }, enter("SLIDE_RIGHT", 400), 41),
      text("stock", c.stock, 20, 127, 170, 14, { color: "#DC2626", fontSize: 10.5, fontWeight: 600 }, enter("FADE_IN", 500)),
      text("price", c.price, 20, 148, priceWidth(c.price, 24) + 6, 30, priceStyle(INK, 24), enter("SLIDE_UP", 300)),
      cta(c.cta, 30 + priceWidth(c.price, 24), 149, "dark", 600),
    ],
  };
}

// ── 11. Back in stock: rubber stamp ───────────────────────────────────────────────
export function backInStock(c: { shop: string; label: string; name: string; price: string; cta: string; stamp: string; photo: PhotoName; tint: string; ink: string; stampColor: string }): Design {
  return {
    background: c.tint,
    elements: [
      photo("product-photo", c.photo, 0, 0, 400, 200, {
        overlay: linear(90, [[0, alpha(c.tint, 0.96)], [0.45, alpha(c.tint, 0.72)], [0.72, alpha(c.tint, 0)]]),
      }),
      shopChip(c.shop),
      text("label", c.label, 20, 56, 190, 14, eyebrow(c.ink), enter("SLIDE_UP", 100)),
      text("name", c.name, 20, 72, 190, 52, heading(c.ink, 22), enter("SLIDE_UP", 200)),
      text("price", c.price, 20, 126, 140, 30, priceStyle(c.ink, 24), enter("SLIDE_UP", 300)),
      cta(c.cta, 20, 160, "dark", 450),
      node("stamp", "CONTAINER", 236, 126, 152, 36, {
        layout: { direction: "row", align: "center", justify: "center" },
        style: { backgroundColor: "rgba(255,255,255,0.78)", border: { width: 3, color: c.stampColor, style: "solid" }, borderRadius: 6 },
        animation: enter("ZOOM_OUT_IN", 500),
        children: [text("stamp-text", c.stamp, 0, 0, 144, 20, { color: c.stampColor, fontFamily: DISPLAY, fontSize: 14, fontWeight: 800, letterSpacing: 1, textAlign: "center", whiteSpace: "nowrap" })],
      }, 80, -12),
    ],
  };
}

// ── 12. Deal of the day: end time in a dark pill ──────────────────────────────────
export function dealOfDay(c: { label: string; name: string; price: string; mrp?: string; ends: string; photo: PhotoName; bg: string; accent: string; position?: Position }): Design {
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 0, 0, 190, 200, { position: c.position ?? "center", anim: enter("FADE_IN") }),
      text("label", c.label, 206, 34, 180, 14, eyebrow(c.accent), enter("SLIDE_UP")),
      text("name", c.name, 206, 50, 180, 52, heading(INK, 22), enter("SLIDE_UP", 100)),
      ...priceRow(206, 104, c.price, c.mrp, INK, 24, 200),
      node("ends", "LABEL", 206, 144, 176, 28, {
        style: { fontFamily: "Poppins", backgroundColor: INK, color: WHITE, fontSize: 10.5, fontWeight: 600, borderRadius: 8, textAlign: "center" },
        content: { text: c.ends, icon: "AccessTime", iconPosition: "left", iconSize: 14 },
        animation: enter("SLIDE_UP", 300, "PULSE"),
      }, 70),
    ],
  };
}

// ── 13. Bestseller: gold badge, rating, sold count ────────────────────────────────
export function bestseller(c: { shop: string; badge: string; name: string; rating: string; price: string; unit: string; cta: string; photo: PhotoName; tint: string; position?: Position }): Design {
  const pw = priceWidth(c.price, 25);
  return {
    background: c.tint,
    elements: [
      photo("product-photo", c.photo, 0, 0, 400, 200, { position: c.position ?? "center", overlay: leftScrim(c.tint, 0.9) }),
      shopChip(c.shop),
      pill("badge", c.badge, 20, 48, 92, 18, { backgroundGradient: linear(90, [[0, "#FBBF24"], [0.5, "#FDE68A"], [1, "#FBBF24"]]), color: "#3B2304", fontSize: 9.5, fontWeight: 700, borderRadius: 9999 }, enter("POP", 100, "GLOW")),
      text("name", c.name, 20, 72, 190, 50, heading(WHITE, 22), enter("SLIDE_UP", 150)),
      text("stars", "★★★★★", 20, 124, 62, 14, { color: "#FBBF24", fontSize: 11, letterSpacing: 1 }, enter("FADE_IN", 250)),
      text("rating", c.rating, 84, 124, 130, 14, { color: WHITE, fontSize: 10.5, opacity: 0.85 }, enter("FADE_IN", 250)),
      text("price", c.price, 20, 144, pw + 6, 32, priceStyle(WHITE, 25), enter("SLIDE_UP", 350)),
      text("unit", c.unit, 24 + pw, 156, 56, 14, { color: WHITE, fontSize: 11, opacity: 0.75 }, enter("SLIDE_UP", 350)),
      cta(c.cta, 84 + pw, 147, "light", 500),
    ],
  };
}

// ── 14. Collection strip: a row of products running off the edge ──────────────────
export function collection(c: { label: string; name: string; info: string; cta: string; items: [Item, Item, Item, Item]; bg: string; serif?: boolean }): Design {
  return {
    background: c.bg,
    elements: [
      ...c.items.flatMap((item, i) => tile(`item-${i + 1}`, item, 150 + i * 78, 14, 72, 172, 100 + i * 100)),
      text("label", c.label, 20, 44, 124, 14, eyebrow(WHITE), enter("FADE_IN")),
      text("name", c.name, 20, 60, 124, 56, { ...heading(WHITE, 24), ...(c.serif === false ? {} : { fontFamily: SERIF }) }, enter("SLIDE_UP", 100)),
      text("info", c.info, 20, 120, 128, 14, { color: WHITE, fontSize: 10, opacity: 0.85, whiteSpace: "nowrap" }, enter("FADE_IN", 200)),
      cta(c.cta, 20, 146, "light", 350),
    ],
  };
}

// ── 15. Quantity prices: buy more, pay less ───────────────────────────────────────
export function quantity(c: { shop: string; name: string; label: string; tiers: [string, string][]; best: number; photo: PhotoName; tint: string; accent: string }): Design {
  return {
    background: c.tint,
    elements: [
      photo("product-photo", c.photo, 0, 0, 400, 200, { overlay: bottomScrim(c.tint) }),
      shopChip(c.shop),
      text("name", c.name, 20, 48, 300, 30, heading(WHITE, 24), enter("SLIDE_UP", 100)),
      text("label", c.label, 20, 80, 220, 14, eyebrow(WHITE), enter("SLIDE_UP", 200)),
      ...c.tiers.slice(0, 3).map(([qty, price], i) => {
        const best = i === c.best;
        return node(`tier-${i + 1}`, "CONTAINER", 20 + i * 123, 120, 113, 60, {
          style: best
            ? { backgroundColor: WHITE, borderRadius: 10 }
            : { backgroundColor: "rgba(255,255,255,0.14)", border: { width: 1, color: "rgba(255,255,255,0.3)", style: "solid" }, borderRadius: 10, backdropBlur: 6 },
          animation: enter(best ? "POP" : "SLIDE_UP", 300 + i * 150),
          children: [
            text(`tier-${i + 1}-qty`, qty, 12, 10, 90, 14, { color: best ? c.accent : WHITE, fontSize: 10, opacity: 0.85 }),
            text(`tier-${i + 1}-price`, price, 12, 26, 92, 26, priceStyle(best ? c.accent : WHITE, 20)),
          ],
        }, 60);
      }),
      pill("best-value", "Best value", 63 + c.best * 123, 112, 62, 16, { backgroundColor: "#FACC15", color: INK, fontSize: 8, fontWeight: 700, borderRadius: 9999 }, enter("POP", 600), 70),
    ],
  };
}

// ── 16. Food with sizes / portions ────────────────────────────────────────────────
export function foodSizes(c: { shop: string; label: string; name: string; options: [string, string]; info: string; cta: string; photo: PhotoName; bg: string; accent: string }): Design {
  const border = { width: 1, color: alpha(c.accent, 0.6), style: "solid" };
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 168, 0, 232, 200, { overlay: fadeFromLeft(c.bg), anim: enter("FADE_IN") }),
      shopChip(c.shop),
      text("label", c.label, 20, 48, 190, 14, eyebrow(c.accent), enter("SLIDE_UP")),
      text("name", c.name, 20, 64, 190, 50, heading(WHITE, 22), enter("SLIDE_UP", 100)),
      pill("option-1", c.options[0], 20, 116, 90, 22, { color: WHITE, fontSize: 10, fontWeight: 600, borderRadius: 6, border }, enter("SLIDE_UP", 200)),
      pill("option-2", c.options[1], 116, 116, 90, 22, { color: WHITE, fontSize: 10, fontWeight: 600, borderRadius: 6, border }, enter("SLIDE_UP", 260)),
      text("info", c.info, 20, 144, 200, 14, { color: WHITE, fontSize: 10, opacity: 0.85, whiteSpace: "nowrap" }, enter("FADE_IN", 300)),
      cta(c.cta, 20, 164, "light", 450, 26),
    ],
  };
}

// ── 17. Bottom bar: full photo, details in a white bar along the bottom ───────────
export function bottomBar(c: { shop: string; tag: string; name: string; price: string; mrp?: string; cta: string; photo: PhotoName; accent: string; position?: Position }): Design {
  const tagW = Math.ceil(c.tag.length * 6) + 22;
  const pw = priceWidth(c.price, 18);
  return {
    background: INK,
    elements: [
      photo("product-photo", c.photo, 0, 0, 400, 200, { position: c.position ?? "center" }),
      shopChip(c.shop),
      pill("tag", c.tag, 386 - tagW, 14, tagW, 22, { backgroundColor: c.accent, color: WHITE, fontSize: 9.5, fontWeight: 700, borderRadius: 9999 }, enter("POP", 300, "PULSE")),
      node("bar", "CONTAINER", 12, 134, 376, 54, {
        style: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 12, shadow: { enabled: true, x: 0, y: 6, blur: 18, spread: -6, color: "rgba(15,23,42,0.35)" } },
        animation: enter("SLIDE_UP", 200),
        children: [
          text("name", c.name, 14, 7, 230, 20, { color: INK, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "ellipsis" }),
          text("price", c.price, 14, 27, pw + 6, 22, priceStyle(c.accent, 18)),
          ...(c.mrp ? [text("mrp", c.mrp, 22 + pw, 31, 60, 16, mrpStyle(INK))] : []),
        ],
      }, 70),
      cta(c.cta, 376 - ctaWidth(c.cta), 147, c.accent, 400),
    ],
  };
}

// ── 18. Coupon ticket: code to use at the counter ─────────────────────────────────
export function coupon(c: { shop: string; off: string; offLabel: string; code: string; note: string; photo: PhotoName; accent: string }): Design {
  return {
    background: c.accent,
    elements: [
      photo("product-photo", c.photo, 0, 0, 150, 200, { anim: enter("FADE_IN") }),
      shopChip(c.shop, 10, 10),
      node("ticket", "CONTAINER", 166, 16, 218, 168, {
        style: { backgroundColor: WHITE, borderRadius: 14, shadow: { enabled: true, x: 0, y: 8, blur: 20, spread: -8, color: "rgba(0,0,0,0.35)" } },
        animation: enter("SLIDE_LEFT", 150),
        children: [
          text("label", "Coupon", 18, 16, 180, 14, eyebrow(c.accent)),
          text("discount", c.off, 18, 32, 190, 40, { ...priceStyle(c.accent, 34), letterSpacing: -1 }),
          text("discount-label", c.offLabel, 18, 74, 186, 16, { color: INK, fontSize: 11, fontWeight: 500 }),
          node("code", "LABEL", 18, 100, 120, 30, {
            style: { fontFamily: DISPLAY, color: INK, fontSize: 14, fontWeight: 800, letterSpacing: 2, borderRadius: 6, backgroundColor: alpha(c.accent, 0.08), border: { width: 2, color: c.accent, style: "dashed" }, textAlign: "center" },
            content: { text: c.code },
          }),
          text("note", c.note, 18, 138, 186, 14, { color: INK, fontSize: 9.5, opacity: 0.6 }),
        ],
      }, 60),
      // Half-circle bites out of both sides of the ticket.
      rect("notch-left", 158, 92, 16, 16, { backgroundColor: c.accent, borderRadius: 9999 }, enter("SLIDE_LEFT", 150), 61),
      rect("notch-right", 376, 92, 16, 16, { backgroundColor: c.accent, borderRadius: 9999 }, enter("SLIDE_LEFT", 150), 61),
    ],
  };
}

// ── 19. Price drop: old price → new price ─────────────────────────────────────────
export function priceDrop(c: { shop: string; label: string; name: string; oldPrice: string; newPrice: string; save: string; cta: string; photo: PhotoName; bg: string; accent: string }): Design {
  const ow = Math.ceil(c.oldPrice.length * 8.6);
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 236, 16, 148, 168, { radius: 14, shadow: true, z: 20, anim: enter("ZOOM_IN", 100) }),
      shopChip(c.shop),
      icon("drop-icon", "ArrowDownward", 20, 50, 14, c.accent, enter("FADE_IN", 100, "BOUNCE")),
      text("label", c.label, 38, 50, 170, 14, { ...eyebrow(c.accent), fontWeight: 700, opacity: 1 }, enter("FADE_IN", 100)),
      text("name", c.name, 20, 68, 200, 50, heading(INK, 22), enter("SLIDE_UP", 150)),
      text("mrp", c.oldPrice, 20, 128, ow + 4, 18, { ...mrpStyle(INK), fontSize: 14 }, enter("FADE_IN", 250)),
      icon("arrow", "ArrowForward", 26 + ow, 129, 16, INK, enter("FADE_IN", 300)),
      text("price", c.newPrice, 48 + ow, 120, 120, 32, priceStyle(c.accent, 26), enter("POP", 400)),
      pill("saving", c.save, 20, 160, 96, 22, { backgroundColor: alpha(c.accent, 0.12), color: c.accent, fontSize: 10, fontWeight: 700, borderRadius: 9999 }, enter("SLIDE_UP", 500)),
      cta(c.cta, 124, 157, "dark", 600),
    ],
  };
}

// ── 20. Big sale word with the product in a circle ────────────────────────────────
export function bigSale(c: { word: string; sub: string; label: string; cta: string; photo: PhotoName; bg: string; ink: string; accent: string; ctaTone: CtaTone }): Design {
  return {
    background: c.bg,
    elements: [
      text("headline", c.word, 16, 18, 240, 84, { color: c.ink, fontFamily: DISPLAY, fontSize: 76, fontWeight: 900, letterSpacing: -3, lineHeight: 1, whiteSpace: "nowrap" }, enter("ZOOM_IN")),
      text("discount", c.sub, 20, 100, 220, 26, { color: c.accent, fontSize: 19, fontWeight: 800, whiteSpace: "nowrap" }, enter("SLIDE_UP", 200)),
      text("label", c.label, 20, 128, 220, 14, { color: c.ink, fontSize: 10.5, opacity: 0.8, whiteSpace: "nowrap" }, enter("SLIDE_UP", 300)),
      cta(c.cta, 20, 154, c.ctaTone, 450),
      photo("product-photo", c.photo, 246, 26, 148, 148, { radius: 9999, border: { width: 4, color: WHITE, style: "solid" }, shadow: true, z: 20, anim: enter("POP", 300, "FLOAT") }),
    ],
  };
}

// ── 21. Four-product grid ─────────────────────────────────────────────────────────
export function fourGrid(c: { label: string; title: string; info: string; cta: string; items: [Item, Item, Item, Item]; bg: string; ink: string }): Design {
  return {
    background: c.bg,
    elements: [
      text("label", c.label, 18, 40, 144, 14, eyebrow(c.ink), enter("FADE_IN")),
      text("name", c.title, 18, 56, 148, 56, heading(c.ink, 23), enter("SLIDE_UP", 100)),
      text("info", c.info, 18, 116, 148, 14, { color: c.ink, fontSize: 10, opacity: 0.75, whiteSpace: "nowrap" }, enter("FADE_IN", 200)),
      cta(c.cta, 18, 142, c.ink === WHITE ? "light" : "dark", 350),
      ...c.items.flatMap((item, i) => miniTile(`item-${i + 1}`, item, 176 + (i % 2) * 106, 12 + Math.floor(i / 2) * 90, 100, 84, 100 + i * 90)),
    ],
  };
}

// ── 22. Polaroid: product in a tilted photo frame ─────────────────────────────────
export function polaroid(c: { shop: string; label: string; name: string; price: string; mrp?: string; cta: string; caption: string; photo: PhotoName; bg: string; ink: string }): Design {
  return {
    background: c.bg,
    elements: [
      node("frame", "CONTAINER", 238, 14, 140, 172, {
        style: { backgroundColor: WHITE, borderRadius: 4, shadow: { enabled: true, x: 0, y: 10, blur: 22, spread: -6, color: "rgba(15,23,42,0.35)" } },
        animation: enter("DROP_IN", 150),
        children: [
          photo("product-photo", c.photo, 8, 8, 124, 124, { radius: 2 }),
          text("caption", c.caption, 8, 138, 124, 24, { color: INK, fontFamily: SERIF, fontStyle: "italic", fontSize: 13, textAlign: "center", whiteSpace: "nowrap" }),
        ],
      }, 40, 5),
      shopChip(c.shop),
      text("label", c.label, 20, 56, 190, 14, eyebrow(c.ink), enter("SLIDE_UP", 100)),
      text("name", c.name, 20, 72, 196, 52, { ...heading(c.ink, 24), fontFamily: SERIF }, enter("SLIDE_UP", 200)),
      ...priceRow(20, 126, c.price, c.mrp, c.ink, 24),
      cta(c.cta, 20, 160, c.ink === WHITE ? "light" : "dark", 450),
    ],
  };
}

// ── 23. Menu card: today's specials with prices ───────────────────────────────────
export function menuCard(c: { label: string; title: string; dishes: [string, string][]; photo: PhotoName; bg: string; accent: string }): Design {
  return {
    background: c.bg,
    elements: [
      rect("plate-glow", 6, 20, 160, 160, { backgroundColor: alpha(c.accent, 0.18), borderRadius: 9999 }, enter("ZOOM_IN"), 5),
      photo("product-photo", c.photo, 16, 30, 140, 140, { radius: 9999, border: { width: 3, color: c.accent, style: "solid" }, z: 20, anim: enter("ROTATE_IN", 100) }),
      text("label", c.label, 180, 26, 204, 14, eyebrow(c.accent), enter("FADE_IN")),
      text("name", c.title, 180, 42, 204, 28, { ...heading(WHITE, 21), fontFamily: SERIF }, enter("SLIDE_UP", 100)),
      ...c.dishes.slice(0, 3).map(([dish, price], i) =>
        node(`dish-${i + 1}`, "CONTAINER", 180, 82 + i * 32, 204, 24, {
          layout: { direction: "row", align: "center", justify: "start", gap: 6 },
          animation: enter("SLIDE_LEFT", 200 + i * 120),
          children: [
            text(`dish-${i + 1}-name`, dish, 0, 0, 104, 16, { color: WHITE, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "ellipsis" }),
            rect(`dish-${i + 1}-dots`, 0, 0, 40, 0, { border: { width: 1, color: "rgba(255,255,255,0.3)", style: "dotted" } }),
            text(`dish-${i + 1}-price`, price, 0, 0, 46, 16, { color: c.accent, fontSize: 13, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }),
          ],
        }, 60),
      ),
    ],
  };
}

// ── 24. Floating card: gradient backdrop, photo card with a price tag ─────────────
export function floatingCard(c: { shop: string; label: string; name: string; price: string; cta: string; photo: PhotoName; from: string; to: string; ink: string; tagColor: string }): Design {
  return {
    background: c.to,
    elements: [
      rect("backdrop", 0, 0, 400, 200, { backgroundGradient: linear(120, [[0, c.from], [1, c.to]]) }, undefined, 0),
      rect("ring", 250, -40, 190, 190, { border: { width: 2, color: alpha(WHITE, 0.25), style: "solid" }, borderRadius: 9999 }, enter("ZOOM_IN"), 2),
      photo("product-photo", c.photo, 226, 20, 156, 160, { radius: 16, shadow: true, z: 20, anim: enter("SLIDE_LEFT", 100, "FLOAT") }),
      pill("price", c.price, 206, 140, 84, 30, { ...priceStyle(c.tagColor, 16), backgroundColor: WHITE, borderRadius: 9999, shadow: { enabled: true, x: 0, y: 6, blur: 14, spread: -4, color: "rgba(0,0,0,0.3)" } }, enter("POP", 500), 70, -6),
      shopChip(c.shop),
      text("label", c.label, 20, 56, 190, 14, eyebrow(c.ink), enter("SLIDE_UP", 100)),
      text("name", c.name, 20, 72, 190, 52, heading(c.ink, 24), enter("SLIDE_UP", 200)),
      cta(c.cta, 20, 140, c.ink === WHITE ? "light" : "dark", 400),
    ],
  };
}

// ── 25. Buy one get one: big offer line and a FREE burst ──────────────────────────
export function bogo(c: { shop: string; offer: string; name: string; info: string; cta: string; photo: PhotoName; bg: string; accent: string }): Design {
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 190, 0, 210, 200, { overlay: fadeFromLeft(c.bg), anim: enter("FADE_IN") }),
      shopChip(c.shop),
      text("headline", c.offer, 20, 50, 200, 66, { ...heading(WHITE, 29), fontWeight: 800 }, enter("ZOOM_IN", 100)),
      text("name", c.name, 20, 118, 190, 16, { color: WHITE, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }, enter("SLIDE_UP", 250)),
      text("info", c.info, 20, 136, 190, 14, { color: WHITE, fontSize: 10, opacity: 0.75, whiteSpace: "nowrap" }, enter("SLIDE_UP", 300)),
      cta(c.cta, 20, 160, "light", 450, 26),
      node("burst", "CONTAINER", 300, 104, 82, 82, {
        layout: { direction: "column", align: "center", justify: "center" },
        style: { backgroundColor: c.accent, clipShape: "burst" },
        animation: enter("POP", 600, "TADA"),
        children: [text("burst-text", "FREE", 0, 0, 60, 22, { color: WHITE, fontFamily: DISPLAY, fontSize: 17, fontWeight: 900, textAlign: "center" })],
      }, 80),
    ],
  };
}

// ── 26. Customer review: a quote and stars beside the product ─────────────────────
export function review(c: { shop: string; quote: string; author: string; name: string; price: string; photo: PhotoName; bg: string; ink: string; accent: string }): Design {
  return {
    background: c.bg,
    elements: [
      photo("product-photo", c.photo, 0, 0, 170, 200, { anim: enter("FADE_IN") }),
      shopChip(c.shop, 10, 10),
      text("stars", "★★★★★", 188, 26, 90, 16, { color: c.accent, fontSize: 14, letterSpacing: 2 }, enter("FADE_IN", 100)),
      text("quote", c.quote, 188, 46, 198, 70, { color: c.ink, fontFamily: SERIF, fontStyle: "italic", fontSize: 17, lineHeight: 1.25, verticalAlign: "top" }, enter("FADE_IN", 200)),
      text("author", c.author, 188, 118, 198, 14, { color: c.ink, fontSize: 10, opacity: 0.65 }, enter("FADE_IN", 350)),
      rect("divider", 188, 140, 196, 1, { backgroundColor: alpha(c.ink, 0.15) }, enter("FADE_IN", 400)),
      text("name", c.name, 188, 150, 110, 32, { color: c.ink, fontSize: 12, fontWeight: 600, lineHeight: 1.2, verticalAlign: "top" }, enter("SLIDE_UP", 450)),
      text("price", c.price, 298, 150, 86, 26, { ...priceStyle(c.accent, 20), textAlign: "right" }, enter("POP", 500)),
    ],
  };
}
