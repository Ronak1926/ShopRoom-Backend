/**
 * prisma/templates/generated.ts — Builds the bulk of the catalog by pairing
 * every shop type (shopTypes.ts) with every layout that suits it, twice: each
 * version uses a different shop name, colour palette and featured product.
 *
 * Layouts that need loose-goods prices (rate card, quantity tiers) only apply
 * to fresh/grocery shops; menus and portion sizes only to food; sizes and
 * colours only to apparel. Text is drawn from each product's `name` or its
 * shorter `short`, whichever the layout has room for.
 */

import { WHITE, type Design, type Item } from "./kit.js";
import * as L from "./layouts.js";
import { SHOP_TYPES, type Palette, type Product, type ShopKind, type ShopType } from "./shopTypes.js";

export interface GeneratedTemplate {
  slug: string;
  name: string;
  categorySlug: string;
  design: () => Design;
}

// ── Formatting helpers ───────────────────────────────────────────────────────────

/** Indian rupee format: ₹999, ₹1,299, ₹1,24,999. */
function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
const withUnit = (p: Product) => `${inr(p.price)}${p.unit ? `/${p.unit}` : ""}`;

/** A believable shelf price: under ₹100 stays exact, above ends in 9. */
function shelfPrice(n: number): number {
  return n < 100 ? Math.round(n) : Math.round(n / 10) * 10 - 1;
}
/** The MRP that makes `price` a `pct`% discount. */
const mrpFor = (price: number, pct: number) => shelfPrice(price / (1 - pct / 100));

/** Mixes a hex colour towards white; used for accents that sit on dark backgrounds. */
function bright(hex: string, amount = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * amount);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const item = (p: Product): Item => ({ photo: p.photo, name: p.short, price: inr(p.price) });
const fits = (p: Product, max: number) => (p.name.length <= max ? p.name : p.short);
/** Shop name for small uppercase labels: the first words that fit in 15 characters. */
function compact(shop: string): string {
  const words = shop.split(" ");
  let out = words[0];
  for (const w of words.slice(1)) {
    if (`${out} ${w}`.length > 15) break;
    out = `${out} ${w}`;
  }
  return out;
}
const DISCOUNTS = [20, 30, 40, 25, 35, 50];
const SIZES: Partial<Record<string, string[]>> = {
  "womens-fashion": ["XS", "S", "M", "L", "XL"],
  "mens-fashion": ["S", "M", "L", "XL", "XXL"],
  footwear: ["6", "7", "8", "9", "10"],
};
const QUOTES: Record<ShopKind, string[]> = {
  fresh: ["“Always fresh and on time!”", "“Best quality in the area.”"],
  grocery: ["“Everything I need, one stop.”", "“Quick delivery, fair prices.”"],
  food: ["“Tastes just like home!”", "“Fresh, filling and tasty.”"],
  apparel: ["“Perfect fit, lovely fabric!”", "“Got so many compliments!”"],
  goods: ["“Great quality for the price!”", "“Exactly as shown. Love it!”"],
};
const AUTHORS = ["Priya S. · regular customer", "Rahul M. · verified buyer", "Neha P. · shops here weekly", "Arjun K. · happy customer"];
const ANNOUNCEMENTS = [
  { icon: "LocalShipping", headline: "Now delivering to your area", sub: "Free delivery on orders above ₹499", cta: "Order now" },
  { icon: "Storefront", headline: "We've moved to a bigger store", sub: "Same lane, just two shops ahead", cta: "Get directions" },
  { icon: "Schedule", headline: "New shop timings from Monday", sub: "Open 8 AM to 10 PM, all week", cta: "See timings" },
  { icon: "Celebration", headline: "Now open on Sundays too", sub: "10 AM to 8 PM every Sunday", cta: "Visit us" },
];

// ── Layout adapters ──────────────────────────────────────────────────────────────

interface Ctx {
  type: ShopType;
  v: number;
  shop: string;
  pal: Palette;
  /** The i-th product for this layout and version, cycling through the list. */
  pick: (i?: number) => Product;
  pct: number;
}

interface Adapter {
  key: string;
  label: string;
  categorySlug: string;
  /** Products needed (and, for price-limited layouts, products under maxPrice). */
  min?: number;
  maxPrice?: number;
  kinds?: ShopKind[];
  /** Named after the shop rather than one product (multi-product and shop-wide layouts). */
  multi?: boolean;
  build: (c: Ctx) => Design;
}

const ADAPTERS: Adapter[] = [
  { key: "hero", label: "Hero", categorySlug: "new-arrival", build: ({ type, shop, pal, pick, pct }) => {
    const p = pick();
    return L.hero({ shop, label: type.newLabel, name: p.name, price: inr(p.price), mrp: inr(mrpFor(p.price, pct)), cta: type.cta, photo: p.photo, tint: pal.tint, position: "center" });
  } },
  { key: "sticker", label: "Price Sticker", categorySlug: "offer", build: ({ type, shop, pal, pick }) => {
    const p = pick();
    return L.sticker({ shop, label: type.newLabel, name: fits(p, 18), stickerLabel: p.unit ? `per ${p.unit}` : "only", price: inr(p.price), cta: type.cta, photo: p.photo, bg: pal.light });
  } },
  { key: "split", label: "Split Card", categorySlug: "offer", build: ({ type, shop, pal, pick, pct }) => {
    const p = pick();
    return L.split({ shop, discount: `${pct}% OFF`, name: p.name, spec: type.newLabel, price: inr(p.price), mrp: inr(mrpFor(p.price, pct)), cta: type.cta, photo: p.photo, accent: pal.accent });
  } },
  { key: "burst", label: "Discount Burst", categorySlug: "sale", build: ({ shop, pal, pick, pct }) => {
    const p = pick();
    return L.burst({ shop, discount: `${pct}%`, name: fits(p, 14), price: inr(p.price), mrp: inr(mrpFor(p.price, pct)), photo: p.photo, bg: pal.light, burst: pal.accent });
  } },
  { key: "pair", label: "Two Products", categorySlug: "new-stock", min: 2, multi: true, build: ({ type, shop, pal, pick }) =>
    L.pair({ label: compact(shop), title: type.newLabel, cta: type.cta, items: [item(pick(0)), item(pick(1))], bg: pal.light, ink: pal.tint, serif: true }) },
  { key: "grid", label: "Three Products", categorySlug: "new-arrival", min: 3, multi: true, build: ({ type, pal, pick }) =>
    L.grid({ title: type.newLabel, link: "See all →", items: [item(pick(0)), item(pick(1)), item(pick(2))], bg: pal.tint, linkColor: bright(pal.accent, 0.55) }) },
  { key: "four", label: "Four Products", categorySlug: "new-stock", min: 4, maxPrice: 9999, multi: true, build: ({ type, shop, v, pal, pick }) =>
    L.fourGrid({ label: compact(shop), title: type.newLabel, info: `${type.products.length} picks in store`, cta: type.cta, items: [item(pick(0)), item(pick(1)), item(pick(2)), item(pick(3))], bg: v === 0 ? pal.light : pal.tint, ink: v === 0 ? pal.tint : WHITE }) },
  { key: "collection", label: "Collection", categorySlug: "new-arrival", min: 4, maxPrice: 9999, multi: true, build: ({ type, shop, pal, pick }) => {
    const items = [pick(0), pick(1), pick(2), pick(3)];
    const from = Math.min(...items.map((p) => p.price));
    return L.collection({ label: compact(shop), name: type.label, info: `${type.products.length} items · from ${inr(from)}`, cta: type.cta, items: [item(items[0]), item(items[1]), item(items[2]), item(items[3])], bg: pal.tint, serif: true });
  } },
  { key: "combo", label: "Combo Deal", categorySlug: "offer", min: 2, multi: true, build: ({ shop, pal, pick }) => {
    const [a, b] = [pick(0), pick(1)];
    const total = shelfPrice((a.price + b.price) * 0.85);
    return L.combo({ label: `${shop} · Combo`, photos: [a.photo, b.photo], comboName: `${a.short} + ${b.short}`, priceLabel: "Both for", price: inr(total), saving: `Save ${inr(a.price + b.price - total)}`, cta: "Get the combo", from: pal.accent, to: pal.tint, soft: pal.light });
  } },
  { key: "rate-card", label: "Rate Card", categorySlug: "new-stock", min: 4, kinds: ["fresh", "grocery"], multi: true, build: ({ type, shop, pal, pick }) =>
    L.rateCard({ label: "Today's rates", name: compact(shop), rows: [0, 1, 2, 3].map((i) => { const p = pick(i); return [p.short, inr(p.price), `/${p.unit ?? "pc"}`]; }), tag: type.newLabel, photo: type.scene, bg: pal.tint, accent: bright(pal.accent, 0.55) }) },
  { key: "quantity", label: "Quantity Prices", categorySlug: "offer", kinds: ["fresh", "grocery"], build: ({ shop, pal, pick }) => {
    const p = pick();
    const unit = p.unit && !/^\d/.test(p.unit) ? p.unit : "pack";
    return L.quantity({ shop, name: p.name, label: "Buy more, pay less", tiers: [[`1 ${unit}`, inr(p.price)], [`3 ${unit}`, inr(shelfPrice(p.price * 3 * 0.93))], [`5 ${unit}`, inr(shelfPrice(p.price * 5 * 0.88))]], best: 2, photo: p.photo, tint: pal.tint, accent: pal.accent });
  } },
  { key: "menu", label: "Menu Card", categorySlug: "custom", min: 3, kinds: ["food"], multi: true, build: ({ type, shop, pal, pick }) => {
    const dishes = [pick(0), pick(1), pick(2)];
    return L.menuCard({ label: compact(shop), title: `Today's ${type.label === "Café" ? "Menu" : "Specials"}`, dishes: dishes.map((p) => [p.short, inr(p.price)]), photo: dishes[0].photo, bg: pal.tint, accent: bright(pal.accent, 0.4) });
  } },
  { key: "sizes", label: "Portion Sizes", categorySlug: "custom", kinds: ["food"], build: ({ type, shop, pal, pick }) => {
    const p = pick();
    return L.foodSizes({ shop, label: type.newLabel, name: p.name, options: [`Regular  ${inr(p.price)}`, `Large  ${inr(shelfPrice(p.price * 1.4))}`], info: "Ready in 20 min · delivery nearby", cta: type.cta, photo: p.photo, bg: pal.tint, accent: bright(pal.accent, 0.45) });
  } },
  { key: "new-arrival", label: "New Arrival", categorySlug: "new-arrival", kinds: ["apparel"], build: ({ type, shop, pal, pick }) => {
    const p = pick();
    return L.newArrival({ shop, ribbon: "NEW", name: p.name, colors: [pal.accent, pal.tint, "#F5F5F4"], sizes: SIZES[type.key] ?? [], price: inr(p.price), photo: p.photo, tint: pal.tint, ribbonColor: pal.accent, position: "center" });
  } },
  { key: "low-stock", label: "Low Stock", categorySlug: "limited-stock", build: ({ shop, v, pal, pick }) => {
    const p = pick();
    const left = v === 0 ? 3 : 5;
    return L.lowStock({ shop, label: v === 0 ? "Almost gone" : "Selling fast", name: p.name, stock: `Only ${left} left in store`, left: left / 25, price: inr(p.price), cta: "Reserve", photo: p.photo, bg: pal.light });
  } },
  { key: "back-in-stock", label: "Back in Stock", categorySlug: "restock", build: ({ shop, pal, pick }) => {
    const p = pick();
    return L.backInStock({ shop, label: "Restocked today", name: p.name, price: withUnit(p), cta: "Order before it's gone", stamp: "BACK IN STOCK", photo: p.photo, tint: pal.light, ink: pal.tint, stampColor: pal.accent });
  } },
  { key: "deal", label: "Deal of the Day", categorySlug: "flash-sale", build: ({ v, pal, pick, pct }) => {
    const p = pick();
    return L.dealOfDay({ label: v === 0 ? "Deal of the day" : "Today only", name: p.name, price: withUnit(p), mrp: inr(mrpFor(p.price, pct)), ends: v === 0 ? "Ends tonight at 11:59 PM" : "Today only · till 9 PM", photo: p.photo, bg: pal.light, accent: pal.accent });
  } },
  { key: "bestseller", label: "Bestseller", categorySlug: "custom", build: ({ type, shop, v, pal, pick }) => {
    const p = pick();
    return L.bestseller({ shop, badge: v === 0 ? "#1 Bestseller" : "Most loved", name: p.name, rating: v === 0 ? "4.9 · 500+ sold" : "4.8 · 1,000+ sold", price: inr(p.price), unit: p.unit ? `/ ${p.unit}` : "", cta: type.cta, photo: p.photo, tint: pal.tint });
  } },
  { key: "bottom-bar", label: "Bottom Bar", categorySlug: "new-stock", build: ({ type, shop, v, pal, pick, pct }) => {
    const p = pick();
    return L.bottomBar({ shop, tag: v === 0 ? "Free delivery" : type.newLabel, name: p.name, price: withUnit(p), mrp: p.unit ? undefined : inr(mrpFor(p.price, pct)), cta: type.cta, photo: p.photo, accent: pal.accent });
  } },
  { key: "coupon", label: "Coupon", categorySlug: "offer", build: ({ shop, v, pal, pick, pct }) => {
    const code = `${shop.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase()}${pct}`;
    return L.coupon({ shop, off: `${pct}% OFF`, offLabel: v === 0 ? "on your next order" : "on bills above ₹999", code, note: v === 0 ? "Show this at the counter" : "Valid till Sunday", photo: pick().photo, accent: pal.accent });
  } },
  { key: "price-drop", label: "Price Drop", categorySlug: "sale", build: ({ shop, pal, pick, pct }) => {
    const p = pick();
    const mrp = mrpFor(p.price, pct);
    return L.priceDrop({ shop, label: "Price dropped", name: p.name, oldPrice: inr(mrp), newPrice: inr(p.price), save: `Save ${inr(mrp - p.price)}`, cta: "Buy now", photo: p.photo, bg: pal.light, accent: pal.accent });
  } },
  { key: "big-sale", label: "Big Sale", categorySlug: "sale", build: ({ type, v, pal, pick, pct }) =>
    L.bigSale({ word: "SALE", sub: `Up to ${pct}% off`, label: `On ${type.label.toLowerCase()} this week`, cta: type.cta, photo: pick().photo, bg: v === 0 ? pal.accent : pal.light, ink: v === 0 ? WHITE : pal.tint, accent: v === 0 ? "#FDE047" : pal.accent, ctaTone: v === 0 ? "light" : "dark" }) },
  { key: "polaroid", label: "Polaroid", categorySlug: "new-arrival", build: ({ type, shop, pal, pick }) => {
    const p = pick();
    return L.polaroid({ shop, label: type.newLabel, name: p.name, price: inr(p.price), cta: type.cta, caption: type.newLabel.toLowerCase(), photo: p.photo, bg: pal.light, ink: pal.tint });
  } },
  { key: "floating", label: "Floating Card", categorySlug: "new-arrival", build: ({ type, shop, v, pal, pick }) => {
    const p = pick();
    return L.floatingCard({ shop, label: type.newLabel, name: p.name, price: inr(p.price), cta: type.cta, photo: p.photo, from: v === 0 ? pal.accent : pal.light, to: v === 0 ? pal.tint : bright(pal.accent, 0.6), ink: v === 0 ? WHITE : pal.tint, tagColor: pal.accent });
  } },
  { key: "bogo", label: "Buy 1 Get 1", categorySlug: "offer", build: ({ shop, v, pal, pick }) => {
    const p = pick();
    return L.bogo({ shop, offer: v === 0 ? "Buy 1 Get 1 Free" : "Buy 2 Get 1 Free", name: `On ${p.short.toLowerCase()}`, info: v === 0 ? "This weekend only" : "Till stocks last", cta: "Grab the offer", photo: p.photo, bg: pal.tint, accent: pal.accent });
  } },
  { key: "review", label: "Customer Review", categorySlug: "custom", build: ({ type, shop, v, pal, pick }) => {
    const p = pick();
    return L.review({ shop, quote: QUOTES[type.kind][v], author: AUTHORS[(v + type.key.length) % AUTHORS.length], name: p.name, price: inr(p.price), photo: p.photo, bg: pal.light, ink: pal.tint, accent: pal.accent });
  } },
  { key: "event", label: "Event", categorySlug: "event", multi: true, build: ({ type, shop, v, pal }) =>
    L.eventDate({ shop, label: v === 0 ? "You're invited" : "Save the date", title: v === 0 ? type.event.title : "Anniversary Week", detail: v === 0 ? type.event.detail : "Gifts for every customer all week", day: v === 0 ? "14" : "21", month: "Dec", cta: v === 0 ? "Reserve a spot" : "Visit us", photo: type.scene, tint: pal.tint, accent: bright(pal.accent, 0.45) }) },
  { key: "announcement", label: "Announcement", categorySlug: "announcement", multi: true, build: ({ type, shop, v, pal }) => {
    const a = ANNOUNCEMENTS[(v * 2 + type.key.length) % ANNOUNCEMENTS.length];
    return L.announcement({ shop, icon: a.icon, headline: a.headline, sub: a.sub, cta: a.cta, photo: type.scene, tint: pal.tint, accent: pal.accent });
  } },
  { key: "reminder", label: "Reminder", categorySlug: "reminder", build: ({ shop, v, pal, pick }) => {
    const p = pick();
    return L.reminder({ shop, label: v === 0 ? "Reminder" : "Saved for you", headline: v === 0 ? "Still thinking about it?" : "It's waiting for you", name: p.name, price: withUnit(p), cta: "Complete order", photo: p.photo, bg: pal.light, accent: pal.accent });
  } },
  { key: "pickup", label: "Order Ready", categorySlug: "reminder", multi: true, build: ({ shop, v, pal, pick }) =>
    L.pickupReady({ shop, headline: "Your order is ready!", sub: v === 0 ? "Pick it up before 9 PM today" : "Collect it from the counter", code: `ORDER #${v === 0 ? "A1042" : "B2087"}`, photo: pick().photo, bg: pal.tint, accent: pal.accent }) },
];

// ── Generation ───────────────────────────────────────────────────────────────────

const VERSIONS = 2;

for (const type of SHOP_TYPES) {
  for (const p of type.products) {
    if (p.short.length > 9) throw new Error(`Short name "${p.short}" (${type.key}) is over 9 characters`);
    if (p.name.length > 22) throw new Error(`Name "${p.name}" (${type.key}) is over 22 characters`);
  }
}

export const GENERATED: GeneratedTemplate[] = SHOP_TYPES.flatMap((type) =>
  ADAPTERS.flatMap((adapter, layoutIndex) => {
    if (adapter.kinds && !adapter.kinds.includes(type.kind)) return [];
    const pool = adapter.maxPrice ? type.products.filter((p) => p.price <= adapter.maxPrice!) : type.products;
    if (pool.length < (adapter.min ?? 1)) return [];
    return Array.from({ length: VERSIONS }, (_, v) => {
      const seed = layoutIndex * 3 + v * 5;
      const pick = (i = 0) => pool[(seed + i) % pool.length];
      const ctx: Ctx = { type, v, shop: type.shops[v], pal: type.palettes[v], pick, pct: DISCOUNTS[(layoutIndex + v) % DISCOUNTS.length] };
      const subject = adapter.multi ? type.shops[v] : pick().short;
      return {
        slug: `${type.key}-${adapter.key}-${v + 1}`,
        name: `${type.label} · ${adapter.label} · ${subject}`,
        categorySlug: adapter.categorySlug,
        design: () => adapter.build(ctx),
      };
    });
  }),
);
