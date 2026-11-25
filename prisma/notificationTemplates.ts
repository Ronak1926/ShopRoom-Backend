/**
 * prisma/notificationTemplates.ts — CounterCircle starter templates as v2 composition
 * trees.
 *
 * SCOPE: a template is the notification's BIG-PICTURE IMAGE — nothing else.
 * Android/iOS draw the app icon, app name, timestamp, title and body text
 * themselves, so the canvas is only the 2:1 banner (400×200) below them.
 *
 * Every template is a PRODUCT banner: a local shop showing its own products
 * with a real photo, the product name, the price and an offer. The sample
 * photos are royalty-free Unsplash images the shopkeeper swaps for their own
 * in the Studio; every word is plain editable text. The first IMAGE in each
 * design is the product photo, which is also what the phone tray shows when
 * the app is closed (see findHeroImageUrl in notificationDispatch.service).
 *
 * Layout convention: node(id, type, x, y, w, h, extra, z) — children, style
 * and the rest live in extra. Children of a container without a layout
 * direction are positioned relative to that container.
 */

import {
  NotificationDesignSchema,
  type NotificationType,
} from "../src/schemas/notification.schema.js";

const CANVAS_W = 400;
const CANVAS_H = 200;
const FONT = "Poppins";
const SERIF = "Playfair Display";
const INK = "#17162B";
const WHITE = "#FFFFFF";
const BRAND = "#6D28D9";

// ── Node helpers ─────────────────────────────────────────────────────────────────

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

function node(id: string, type: string, x: number, y: number, w: number, h: number, extra: Extra = {}, z = 50, rotation = 0) {
  return { id, type, frame: { x, y, width: w, height: h, rotation, zIndex: z }, ...extra };
}

/** Entrance animation; an optional looping emphasis starts once it has finished. */
function enter(type: string, delayMs = 0, attention?: string) {
  return {
    entry: { type, delayMs, durationMs: 600, easing: "easeOut" },
    ...(attention ? { attention: { type: attention, delayMs: delayMs + 900, durationMs: 1600, repeat: "infinite" } } : {}),
  };
}

function photoUrl(photoId: string): string {
  return `https://images.unsplash.com/photo-${photoId}?w=900&q=75&auto=format&fit=crop`;
}

function linear(angle: number, stops: [number, string][]) {
  return { type: "LINEAR", angle, stops: stops.map(([offset, color]) => ({ offset, color })) };
}

interface PhotoOpts { position?: string; overlay?: Obj; radius?: number; border?: Obj; z?: number; anim?: Obj }
function photo(id: string, photoId: string, x: number, y: number, w: number, h: number, o: PhotoOpts = {}) {
  return node(id, "IMAGE", x, y, w, h, {
    asset: { type: "IMAGE", url: photoUrl(photoId), attribution: { provider: "UNSPLASH" } },
    image: { fit: "cover", position: o.position ?? "center", ...(o.overlay ? { overlay: { gradient: o.overlay, opacity: 1 } } : {}) },
    style: { ...(o.radius != null ? { borderRadius: o.radius } : {}), ...(o.border ? { border: o.border } : {}) },
    ...(o.anim ? { animation: o.anim } : {}),
  }, o.z ?? 1);
}

function text(id: string, value: string, x: number, y: number, w: number, h: number, style: Obj, anim?: Obj, z = 60) {
  return node(id, "TEXT", x, y, w, h, {
    style: { fontFamily: FONT, textAlign: "left", lineHeight: 1.1, ...style },
    content: { text: value },
    ...(anim ? { animation: anim } : {}),
  }, z);
}

/** A text pill. LABEL rather than TEXT so a border outlines the box, not the glyphs. */
function pill(id: string, value: string, x: number, y: number, w: number, h: number, style: Obj, anim?: Obj, z = 65, rotation = 0) {
  return node(id, "LABEL", x, y, w, h, {
    style: { fontFamily: FONT, textAlign: "center", lineHeight: 1, ...style },
    content: { text: value },
    ...(anim ? { animation: anim } : {}),
  }, z, rotation);
}

function rect(id: string, x: number, y: number, w: number, h: number, style: Obj, anim?: Obj, z = 40) {
  return node(id, "RECTANGLE", x, y, w, h, { style, ...(anim ? { animation: anim } : {}) }, z);
}

const eyebrow = (color: string): Obj => ({ color, fontSize: 9.5, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", opacity: 0.92, whiteSpace: "nowrap" });
const heading = (color: string, size = 24): Obj => ({ color, fontSize: size, fontWeight: 700, lineHeight: 1.05, letterSpacing: -0.4, verticalAlign: "top" });
const priceStyle = (color: string, size = 26): Obj => ({ color, fontSize: size, fontWeight: 800, letterSpacing: -0.5, whiteSpace: "nowrap" });
const mrpStyle = (color: string): Obj => ({ color, fontSize: 12, fontWeight: 500, opacity: 0.7, textDecoration: "line-through", whiteSpace: "nowrap" });

/** The shop's name in a white pill, top-left (or wherever the layout needs it). */
function shopChip(name: string, x = 14, y = 14, bg = "rgba(255,255,255,0.95)") {
  const w = Math.ceil(name.length * 6.2) + 34;
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

type CtaTone = "light" | "dark" | "brand";
const CTA_TONES: Record<CtaTone, { bg: string; fg: string }> = {
  light: { bg: WHITE, fg: INK },
  dark: { bg: INK, fg: WHITE },
  brand: { bg: BRAND, fg: WHITE },
};

function cta(label: string, x: number, y: number, tone: CtaTone, delayMs: number, h = 28) {
  const t = CTA_TONES[tone];
  const textW = Math.ceil(label.length * 6.8) + 4;
  return node("cta", "BUTTON", x, y, textW + 30, h, {
    layout: { direction: "row", align: "center", justify: "center" },
    style: { backgroundColor: t.bg, borderRadius: 9999, shadow: { enabled: true, x: 0, y: 4, blur: 12, spread: -4, color: "rgba(15,23,42,0.35)" } },
    interaction: { onClick: { type: "OPEN_PRODUCT", target: "{{product.id}}" } },
    animation: enter("SLIDE_UP", delayMs),
    children: [text("cta-label", label, 0, 0, textW, 14, { color: t.fg, fontSize: 11, fontWeight: 600, textAlign: "center", whiteSpace: "nowrap" })],
  }, 95);
}

/** Small product tile: photo with a white caption (name + price) at the bottom. */
function tile(id: string, photoId: string, x: number, y: number, w: number, h: number, name: string, price: string, delayMs: number) {
  return [
    photo(`${id}-photo`, photoId, x, y, w, h, { radius: 10, z: 20, anim: enter("SLIDE_UP", delayMs) }),
    node(`${id}-caption`, "CONTAINER", x + 6, y + h - 40, w - 12, 34, {
      layout: { direction: "column", align: "start", justify: "center", gap: 1, padding: { left: 8, right: 8 } },
      style: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 7 },
      animation: enter("FADE_IN", delayMs + 200),
      children: [
        text(`${id}-name`, name, 0, 0, w - 28, 12, { color: INK, fontSize: 9, fontWeight: 600, overflow: "ellipsis" }),
        text(`${id}-price`, price, 0, 0, w - 28, 15, { color: INK, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }),
      ],
    }, 30),
  ];
}

// ── The sixteen product banners ──────────────────────────────────────────────────

const PHOTOS = {
  saree: "1610030469983-98e550d6193c",
  headphones: "1505740420928-5e560c06d30e",
  smartwatch: "1546868871-7041f2a55e12",
  loafers: "1560343090-f0409e92791a",
  tee: "1521572163474-6864f9cf17ab",
  sweatshirt: "1620799140408-edc6dcb6d633",
  shirts: "1602810318383-e386cc2a3ccf",
  backpack: "1553062407-98eeb64c6a62",
  sneaker: "1491553895911-0055eca6402d",
  vegetables: "1542838132-92c53300491e",
  anarkali: "1583391733956-3750e0ff4e8b",
  watches: "1523275335684-37898b6baf30",
  makeup: "1596462502278-27bfdc403348",
  watermelon: "1587049352846-4a222e784d38",
  cake: "1578985545062-69928b1d9587",
  apples: "1567306226416-28f0efdc88ce",
  pizza: "1513104890138-7c749659a591",
};

/** Left-to-right darkening so white copy reads on any photo. */
const leftScrim = (rgb: string, strong = 0.88) =>
  linear(90, [[0, `rgba(${rgb},${strong})`], [0.45, `rgba(${rgb},${(strong * 0.6).toFixed(2)})`], [0.78, `rgba(${rgb},0)`]]);
/** Fades a side photo into the flat background colour next to it. */
const fadeFromLeft = (rgb: string) => linear(90, [[0, `rgb(${rgb})`], [0.32, `rgba(${rgb},0)`]]);

interface Template {
  slug: string;
  name: string;
  category: NotificationType;
  categorySlug: string;
  background: string;
  elements: () => unknown[];
}

const TEMPLATE_LIST: Template[] = [
  {
    slug: "product-hero", name: "Hero Product", category: "NEW_ARRIVAL", categorySlug: "new-arrival", background: "#3A0A12",
    elements: () => [
      photo("product-photo", PHOTOS.saree, 0, 0, 400, 200, { position: "top", overlay: leftScrim("20,6,10") }),
      shopChip("Riya Boutique"),
      text("label", "New in store", 20, 56, 200, 14, eyebrow(WHITE), enter("SLIDE_UP", 100)),
      text("name", "Banarasi Silk Saree", 20, 72, 200, 52, heading(WHITE), enter("SLIDE_UP", 200)),
      text("price", "₹4,299", 20, 126, 88, 30, priceStyle(WHITE), enter("SLIDE_UP", 300)),
      text("mrp", "₹6,499", 108, 136, 60, 16, mrpStyle(WHITE), enter("SLIDE_UP", 300)),
      cta("View in shop", 20, 162, "light", 450),
    ],
  },
  {
    slug: "product-price-sticker", name: "Price Sticker", category: "OFFER", categorySlug: "offer", background: "#F7C518",
    elements: () => [
      photo("product-photo", PHOTOS.headphones, 150, 0, 250, 200, { overlay: fadeFromLeft("247,197,24") }),
      shopChip("SoundHub"),
      text("label", "Wireless · 30h battery", 20, 58, 180, 14, eyebrow(INK), enter("SLIDE_UP", 100)),
      text("name", "Studio Headphones", 20, 74, 170, 52, heading(INK), enter("SLIDE_UP", 200)),
      cta("Buy now", 20, 134, "dark", 400),
      node("sticker", "CONTAINER", 180, 104, 82, 82, {
        layout: { direction: "column", align: "center", justify: "center", gap: 0 },
        style: { backgroundColor: INK, borderRadius: 9999, shadow: { enabled: true, x: 0, y: 6, blur: 16, spread: -4, color: "rgba(0,0,0,0.35)" } },
        animation: enter("POP", 500, "PULSE"),
        children: [
          text("sticker-label", "only", 0, 0, 70, 12, { color: WHITE, fontSize: 9.5, fontWeight: 500, opacity: 0.8, textAlign: "center" }),
          text("price", "₹1,299", 0, 0, 76, 24, { ...priceStyle(WHITE, 19), textAlign: "center" }),
        ],
      }, 80),
    ],
  },
  {
    slug: "product-split-card", name: "Split Card", category: "OFFER", categorySlug: "offer", background: WHITE,
    elements: () => [
      photo("product-photo", PHOTOS.smartwatch, 0, 0, 184, 200, { anim: enter("FADE_IN") }),
      shopChip("Gadget Point", 283, 14, "#F3F0FB"),
      pill("discount", "25% OFF", 202, 36, 58, 18, { backgroundColor: "#16A34A", color: WHITE, fontSize: 9.5, fontWeight: 700, borderRadius: 4 }, enter("POP", 200)),
      text("name", "Smart Watch S2", 202, 58, 186, 50, heading(INK, 22), enter("SLIDE_LEFT", 250)),
      text("spec", "AMOLED · 7-day battery", 202, 110, 186, 14, { color: "#6B6A80", fontSize: 10.5 }, enter("SLIDE_LEFT", 320)),
      text("price", "₹2,999", 202, 126, 88, 30, priceStyle(INK), enter("SLIDE_LEFT", 400)),
      text("mrp", "₹3,999", 290, 136, 60, 16, mrpStyle(INK), enter("SLIDE_LEFT", 400)),
      cta("Order now", 202, 162, "brand", 550),
    ],
  },
  {
    slug: "product-discount-burst", name: "Discount Burst", category: "SALE", categorySlug: "sale", background: "#F3E5DD",
    elements: () => [
      photo("product-photo", PHOTOS.loafers, 0, 0, 400, 200),
      shopChip("Step Up Shoes"),
      node("burst", "CONTAINER", 288, 12, 98, 98, {
        layout: { direction: "column", align: "center", justify: "center", gap: 0 },
        style: { backgroundColor: "#E11D48", clipShape: "burst" },
        animation: enter("POP", 400, "PULSE"),
        children: [
          text("discount", "40%", 0, 0, 70, 28, { color: WHITE, fontSize: 24, fontWeight: 800, textAlign: "center" }),
          text("discount-label", "OFF", 0, 0, 50, 13, { color: WHITE, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textAlign: "center" }),
        ],
      }, 80),
      node("price-card", "CONTAINER", 16, 112, 172, 74, {
        style: { backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 10, shadow: { enabled: true, x: 0, y: 6, blur: 16, spread: -6, color: "rgba(15,23,42,0.25)" } },
        animation: enter("SLIDE_UP", 300),
        children: [
          text("name", "Suede Loafers", 12, 10, 150, 24, heading(INK, 18)),
          text("price", "₹1,799", 12, 36, 86, 30, priceStyle(INK, 24)),
          text("mrp", "₹2,999", 100, 45, 62, 16, mrpStyle(INK)),
        ],
      }, 70),
    ],
  },
  {
    slug: "product-pair", name: "Two Products", category: "NEW_STOCK", categorySlug: "new-stock", background: "#F4EFE6",
    elements: () => [
      text("label", "Cotton Co.", 20, 50, 130, 14, eyebrow("#2B2118"), enter("SLIDE_UP")),
      text("name", "Everyday basics", 20, 66, 136, 58, { ...heading("#2B2118", 24), fontFamily: SERIF }, enter("SLIDE_UP", 100)),
      cta("See sizes", 20, 132, "dark", 300),
      ...tile("item-1", PHOTOS.tee, 166, 14, 104, 172, "Cotton Tee", "₹399", 150),
      ...tile("item-2", PHOTOS.sweatshirt, 282, 14, 104, 172, "Sweatshirt", "₹899", 280),
    ],
  },
  {
    slug: "product-grid", name: "Three Products", category: "NEW_ARRIVAL", categorySlug: "new-arrival", background: "#0F172A",
    elements: () => [
      text("name", "New this week", 16, 14, 220, 26, heading(WHITE, 18), enter("FADE_IN")),
      text("link", "See all →", 296, 18, 88, 18, { color: "#A5B4FC", fontSize: 11, fontWeight: 600, textAlign: "right" }, enter("FADE_IN", 100)),
      ...tile("item-1", PHOTOS.shirts, 16, 50, 116, 136, "Linen Shirt", "₹799", 100),
      ...tile("item-2", PHOTOS.backpack, 142, 50, 116, 136, "Daypack", "₹1,199", 200),
      ...tile("item-3", PHOTOS.sneaker, 268, 50, 116, 136, "Runner", "₹1,899", 300),
    ],
  },
  {
    slug: "product-rate-card", name: "Daily Rate Card", category: "NEW_STOCK", categorySlug: "new-stock", background: "#0F3D2E",
    elements: () => {
      const rows: [string, string, string][] = [["Tomato", "₹40", "/kg"], ["Onion", "₹35", "/kg"], ["Potato", "₹30", "/kg"], ["Spinach", "₹20", "/bunch"]];
      return [
        photo("product-photo", PHOTOS.vegetables, 0, 0, 160, 200, { anim: enter("FADE_IN") }),
        pill("tag", "Fresh stock", 10, 172, 72, 18, { backgroundColor: "#BEF264", color: "#0F3D2E", fontSize: 9, fontWeight: 700, borderRadius: 9999 }, enter("POP", 600)),
        text("label", "Today's rates · 7 AM", 178, 22, 206, 14, eyebrow(WHITE), enter("SLIDE_UP")),
        text("name", "Sharma Sabzi", 178, 38, 206, 28, heading(WHITE, 20), enter("SLIDE_UP", 60)),
        ...rows.map(([item, price, unit], i) =>
          node(`row-${i + 1}`, "CONTAINER", 178, 74 + i * 27, 206, 22, {
            layout: { direction: "row", align: "center", justify: "start", gap: 6 },
            animation: enter("SLIDE_LEFT", 150 + i * 100),
            children: [
              text(`row-${i + 1}-item`, item, 0, 0, 68, 16, { color: WHITE, fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap" }),
              rect(`row-${i + 1}-dots`, 0, 0, 44, 0, { border: { width: 1, color: "rgba(255,255,255,0.35)", style: "dotted" } }),
              text(`row-${i + 1}-price`, price, 0, 0, 38, 16, { color: "#BEF264", fontSize: 13, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }),
              text(`row-${i + 1}-unit`, unit, 0, 0, 38, 14, { color: WHITE, fontSize: 9, opacity: 0.7, whiteSpace: "nowrap" }),
            ],
          }, 60),
        ),
      ];
    },
  },
  {
    slug: "product-combo", name: "Combo Deal", category: "OFFER", categorySlug: "offer", background: "#4C1D95",
    elements: () => [
      rect("backdrop", 0, 0, 400, 200, { backgroundGradient: linear(135, [[0, "#7C3AED"], [1, "#3B0764"]]) }, undefined, 0),
      text("label", "Urban Store · Combo deal", 20, 18, 250, 14, eyebrow("#E9D5FF"), enter("FADE_IN")),
      photo("product-photo", PHOTOS.sneaker, 20, 50, 84, 84, { radius: 9999, border: { width: 3, color: WHITE, style: "solid" }, z: 30, anim: enter("POP", 100) }),
      text("plus", "+", 108, 74, 24, 34, { color: WHITE, fontSize: 30, fontWeight: 300, textAlign: "center" }, enter("FADE_IN", 300)),
      photo("product-photo-2", PHOTOS.backpack, 136, 50, 84, 84, { radius: 9999, border: { width: 3, color: WHITE, style: "solid" }, z: 30, anim: enter("POP", 400) }),
      text("name", "Runner + Daypack", 20, 152, 200, 16, { color: WHITE, fontSize: 11, opacity: 0.85 }, enter("FADE_IN", 500)),
      text("price-label", "Both for", 250, 40, 134, 14, { ...eyebrow(WHITE), textAlign: "right" }, enter("FADE_IN", 500)),
      text("price", "₹2,499", 230, 56, 154, 44, { ...priceStyle(WHITE, 36), textAlign: "right" }, enter("POP", 600)),
      pill("saving", "Save ₹600", 310, 104, 74, 20, { backgroundColor: "#FACC15", color: "#3B0764", fontSize: 10, fontWeight: 700, borderRadius: 9999 }, enter("SLIDE_UP", 750)),
      cta("Grab the combo", 254, 138, "light", 900),
    ],
  },
  {
    slug: "product-new-arrival", name: "New Arrival", category: "NEW_ARRIVAL", categorySlug: "new-arrival", background: "#1C2A24",
    elements: () => [
      photo("product-photo", PHOTOS.anarkali, 0, 0, 400, 200, { position: "top", overlay: leftScrim("18,28,24") }),
      shopChip("Riya Boutique"),
      pill("ribbon", "NEW", 322, 14, 120, 20, { backgroundColor: "#F43F5E", color: WHITE, fontSize: 10, fontWeight: 800, letterSpacing: 3 }, enter("FADE_IN", 500), 85, 35),
      text("name", "Chikankari Anarkali", 20, 54, 200, 52, heading(WHITE), enter("SLIDE_UP", 100)),
      ...["#E8EFE9", "#F4C2C2", "#C7D2FE"].map((color, i) =>
        rect(`colour-${i + 1}`, 20 + i * 18, 112, 13, 13, { backgroundColor: color, borderRadius: 9999, border: { width: 2, color: WHITE, style: "solid" } }, enter("POP", 200 + i * 60), 60),
      ),
      ...["S", "M", "L", "XL"].map((size, i) =>
        pill(`size-${i + 1}`, size, 20 + i * 26, 132, 22, 16, { color: WHITE, fontSize: 9, fontWeight: 600, borderRadius: 3, border: { width: 1, color: "rgba(255,255,255,0.7)", style: "solid" } }, enter("SLIDE_UP", 300)),
      ),
      text("price", "₹2,450", 20, 154, 120, 32, priceStyle(WHITE), enter("SLIDE_UP", 400)),
    ],
  },
  {
    slug: "product-low-stock", name: "Low Stock", category: "LIMITED_STOCK", categorySlug: "limited-stock", background: "#F1F1EF",
    elements: () => [
      photo("product-photo", PHOTOS.watches, 192, 0, 208, 200, { overlay: fadeFromLeft("241,241,239"), anim: enter("FADE_IN") }),
      shopChip("Time House"),
      rect("alert-dot", 20, 52, 8, 8, { backgroundColor: "#DC2626", borderRadius: 9999 }, enter("FADE_IN", 0, "PULSE"), 60),
      text("label", "Almost gone", 34, 49, 140, 14, { ...eyebrow("#DC2626"), fontWeight: 700, opacity: 1 }, enter("FADE_IN")),
      text("name", "Classic White Watch", 20, 66, 176, 46, heading(INK, 21), enter("SLIDE_UP", 100)),
      rect("stock-track", 20, 116, 170, 7, { backgroundColor: "#E2E0E8", borderRadius: 9999 }, enter("FADE_IN", 200)),
      rect("stock-fill", 20, 116, 34, 7, { backgroundGradient: linear(90, [[0, "#F97316"], [1, "#DC2626"]]), borderRadius: 9999 }, enter("SLIDE_RIGHT", 400), 41),
      text("stock", "Only 4 left in store", 20, 127, 170, 14, { color: "#DC2626", fontSize: 10.5, fontWeight: 600 }, enter("FADE_IN", 500)),
      text("price", "₹3,499", 20, 148, 92, 30, priceStyle(INK, 24), enter("SLIDE_UP", 300)),
      cta("Reserve now", 112, 149, "dark", 600),
    ],
  },
  {
    slug: "product-back-in-stock", name: "Back in Stock", category: "RESTOCK", categorySlug: "restock", background: "#FAE8D6",
    elements: () => [
      photo("product-photo", PHOTOS.makeup, 0, 0, 400, 200, {
        overlay: linear(90, [[0, "rgba(250,232,214,0.96)"], [0.45, "rgba(250,232,214,0.72)"], [0.72, "rgba(250,232,214,0)"]]),
      }),
      shopChip("Glow Beauty"),
      text("label", "Restocked today", 20, 56, 190, 14, eyebrow("#3B1D1D"), enter("SLIDE_UP", 100)),
      text("name", "Rose Glow Makeup Kit", 20, 72, 190, 52, heading("#3B1D1D", 22), enter("SLIDE_UP", 200)),
      text("price", "₹1,150", 20, 126, 120, 30, priceStyle("#3B1D1D", 24), enter("SLIDE_UP", 300)),
      cta("Order before it's gone", 20, 160, "dark", 450),
      node("stamp", "CONTAINER", 236, 126, 152, 36, {
        layout: { direction: "row", align: "center", justify: "center" },
        style: { backgroundColor: "rgba(255,255,255,0.78)", border: { width: 3, color: "#BE123C", style: "solid" }, borderRadius: 6 },
        animation: enter("ZOOM_OUT_IN", 500),
        children: [text("stamp-text", "BACK IN STOCK", 0, 0, 144, 20, { color: "#BE123C", fontFamily: "Montserrat", fontSize: 14, fontWeight: 800, letterSpacing: 1, textAlign: "center", whiteSpace: "nowrap" })],
      }, 80, -12),
    ],
  },
  {
    slug: "product-deal-of-the-day", name: "Deal of the Day", category: "FLASH_SALE", categorySlug: "flash-sale", background: "#FBFBF8",
    elements: () => [
      photo("product-photo", PHOTOS.watermelon, 0, 0, 190, 200, { position: "left", anim: enter("FADE_IN") }),
      text("label", "Deal of the day", 206, 34, 180, 14, eyebrow("#E11D48"), enter("SLIDE_UP")),
      text("name", "Sweet Watermelon", 206, 50, 180, 52, heading(INK, 22), enter("SLIDE_UP", 100)),
      text("price", "₹25/kg", 206, 104, 96, 30, priceStyle(INK, 24), enter("SLIDE_UP", 200)),
      text("mrp", "₹40", 302, 113, 50, 16, mrpStyle(INK), enter("SLIDE_UP", 200)),
      node("ends", "LABEL", 206, 144, 172, 28, {
        style: { fontFamily: FONT, backgroundColor: INK, color: WHITE, fontSize: 10.5, fontWeight: 600, borderRadius: 8, textAlign: "center" },
        content: { text: "Ends tonight at 11:59 PM", icon: "AccessTime", iconPosition: "left", iconSize: 14 },
        animation: enter("SLIDE_UP", 300, "PULSE"),
      }, 70),
    ],
  },
  {
    slug: "product-bestseller", name: "Bestseller", category: "CUSTOM", categorySlug: "custom", background: "#1C0E06",
    elements: () => [
      photo("product-photo", PHOTOS.cake, 0, 0, 400, 200, { overlay: leftScrim("28,14,6", 0.9) }),
      shopChip("Sweet Tooth Bakery"),
      pill("badge", "#1 Bestseller", 20, 48, 86, 18, { backgroundGradient: linear(90, [[0, "#FBBF24"], [0.5, "#FDE68A"], [1, "#FBBF24"]]), color: "#3B2304", fontSize: 9.5, fontWeight: 700, borderRadius: 9999 }, enter("POP", 100, "GLOW")),
      text("name", "Chocolate Truffle Cake", 20, 72, 190, 50, heading(WHITE, 22), enter("SLIDE_UP", 150)),
      text("stars", "★★★★★", 20, 124, 62, 14, { color: "#FBBF24", fontSize: 11, letterSpacing: 1 }, enter("FADE_IN", 250)),
      text("rating", "4.9 · 500+ sold", 84, 124, 120, 14, { color: WHITE, fontSize: 10.5, opacity: 0.85 }, enter("FADE_IN", 250)),
      text("price", "₹549", 20, 144, 66, 32, priceStyle(WHITE, 25), enter("SLIDE_UP", 350)),
      text("unit", "/ 500g", 84, 156, 50, 14, { color: WHITE, fontSize: 11, opacity: 0.75 }, enter("SLIDE_UP", 350)),
      cta("Pre-order", 140, 147, "light", 500),
    ],
  },
  {
    slug: "product-collection", name: "Collection Strip", category: "NEW_ARRIVAL", categorySlug: "new-arrival", background: "#111111",
    elements: () => [
      ...tile("item-1", PHOTOS.saree, 150, 14, 72, 172, "Saree", "₹4,299", 100),
      ...tile("item-2", PHOTOS.anarkali, 228, 14, 72, 172, "Anarkali", "₹2,450", 200),
      ...tile("item-3", PHOTOS.shirts, 306, 14, 72, 172, "Shirt", "₹799", 300),
      ...tile("item-4", PHOTOS.sweatshirt, 384, 14, 72, 172, "Sweatshirt", "₹899", 400),
      text("label", "Riya Boutique", 20, 44, 120, 14, eyebrow(WHITE), enter("FADE_IN")),
      text("name", "Festive Collection", 20, 60, 124, 56, { ...heading(WHITE, 24), fontFamily: SERIF }, enter("SLIDE_UP", 100)),
      text("info", "12 new pieces · from ₹399", 20, 120, 128, 14, { color: WHITE, fontSize: 10, opacity: 0.85, whiteSpace: "nowrap" }, enter("FADE_IN", 200)),
      cta("Browse all", 20, 146, "light", 350),
    ],
  },
  {
    slug: "product-quantity-prices", name: "Quantity Prices", category: "OFFER", categorySlug: "offer", background: "#3C0808",
    elements: () => {
      const tiers: [string, string][] = [["1 kg", "₹180"], ["3 kg", "₹500"], ["5 kg", "₹800"]];
      return [
        photo("product-photo", PHOTOS.apples, 0, 0, 400, 200, { overlay: linear(180, [[0, "rgba(60,8,8,0.35)"], [0.8, "rgba(40,6,6,0.92)"]]) }),
        shopChip("Fresh Fruits Corner"),
        text("name", "Kashmiri Apples", 20, 48, 300, 30, heading(WHITE, 24), enter("SLIDE_UP", 100)),
        text("label", "Buy more, pay less", 20, 80, 200, 14, eyebrow(WHITE), enter("SLIDE_UP", 200)),
        ...tiers.map(([qty, price], i) => {
          const best = i === 1;
          return node(`tier-${i + 1}`, "CONTAINER", 20 + i * 123, 120, 113, 60, {
            style: best
              ? { backgroundColor: WHITE, borderRadius: 10 }
              : { backgroundColor: "rgba(255,255,255,0.14)", border: { width: 1, color: "rgba(255,255,255,0.3)", style: "solid" }, borderRadius: 10, backdropBlur: 6 },
            animation: enter(best ? "POP" : "SLIDE_UP", 300 + i * 150),
            children: [
              text(`tier-${i + 1}-qty`, qty, 12, 10, 90, 14, { color: best ? "#7F1D1D" : WHITE, fontSize: 10, opacity: 0.85 }),
              text(`tier-${i + 1}-price`, price, 12, 26, 90, 26, priceStyle(best ? "#7F1D1D" : WHITE, 20)),
            ],
          }, 60);
        }),
        pill("best-value", "Best value", 186, 112, 62, 16, { backgroundColor: "#FACC15", color: "#3B0764", fontSize: 8, fontWeight: 700, borderRadius: 9999 }, enter("POP", 600), 70),
      ];
    },
  },
  {
    slug: "product-food-sizes", name: "Food with Sizes", category: "CUSTOM", categorySlug: "custom", background: "#1C1007",
    elements: () => [
      photo("product-photo", PHOTOS.pizza, 168, 0, 232, 200, { overlay: fadeFromLeft("28,16,7"), anim: enter("FADE_IN") }),
      shopChip("Slice Point"),
      text("label", "Hot & fresh", 20, 48, 190, 14, eyebrow("#FDBA74"), enter("SLIDE_UP")),
      text("name", "Farmhouse Pizza", 20, 64, 190, 50, heading(WHITE, 22), enter("SLIDE_UP", 100)),
      pill("option-1", "Medium  ₹249", 20, 116, 86, 22, { color: WHITE, fontSize: 10, fontWeight: 600, borderRadius: 6, border: { width: 1, color: "rgba(253,186,116,0.6)", style: "solid" } }, enter("SLIDE_UP", 200)),
      pill("option-2", "Large  ₹399", 112, 116, 80, 22, { color: WHITE, fontSize: 10, fontWeight: 600, borderRadius: 6, border: { width: 1, color: "rgba(253,186,116,0.6)", style: "solid" } }, enter("SLIDE_UP", 260)),
      text("info", "Ready in 20 min · free delivery nearby", 20, 144, 200, 14, { color: WHITE, fontSize: 10, opacity: 0.85, whiteSpace: "nowrap" }, enter("FADE_IN", 300)),
      cta("Order now", 20, 164, "light", 450, 26),
    ],
  },
];

function buildTemplate(t: Template) {
  const now = new Date().toISOString();
  return NotificationDesignSchema.parse({
    schemaVersion: 2,
    id: t.slug,
    name: t.name,
    category: t.category,
    status: "DRAFT",
    canvas: { width: CANVAS_W, height: CANVAS_H, background: { type: "SOLID", color: t.background } },
    timeline: { durationMs: 3000 },
    elements: t.elements(),
    metadata: { createdAt: now, updatedAt: now, source: "SHOPROOM_TEMPLATE" },
  });
}

export const TEMPLATES = TEMPLATE_LIST.map((t) => ({
  slug: t.slug,
  name: t.name,
  categorySlug: t.categorySlug,
  build: () => buildTemplate(t),
}));
