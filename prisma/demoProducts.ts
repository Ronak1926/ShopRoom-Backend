/**
 * prisma/demoProducts.ts — DEV/DEMO product data only.
 *
 * A small set of ORIGINAL, non-branded product illustrations (flat SVG, no
 * logos) used to preview templates with a real image in the {{product.image}}
 * slot. Production never uses these — the resolver receives the shopkeeper's
 * actual Cloudinary product URL through the same context shape.
 */

import type { RenderContext } from "../src/utils/variableResolver.js";

function uri(svg: string): string {
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// ── Original non-branded product art (transparent, ~240×240) ─────────────────────

const TSHIRT = `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><path d="M86 64 58 88 76 114 92 102v78a8 8 0 0 0 8 8h44a8 8 0 0 0 8-8v-78l16 12 18-26-28-24q-34 22-72 0Z" fill="#6D5AE0"/><path d="M86 64q34 22 72 0l-8 12q-28 16-56 0Z" fill="#4C1D95"/></svg>`;

const HEADPHONES = `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><path d="M62 132v-8a58 58 0 0 1 116 0v8" fill="none" stroke="#1F2937" stroke-width="12" stroke-linecap="round"/><rect x="48" y="124" width="30" height="60" rx="12" fill="#374151"/><rect x="162" y="124" width="30" height="60" rx="12" fill="#374151"/><rect x="54" y="132" width="18" height="30" rx="8" fill="#10B981"/><rect x="168" y="132" width="18" height="30" rx="8" fill="#10B981"/></svg>`;

const BAG = `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><path d="M92 92V78a28 28 0 0 1 56 0v14" fill="none" stroke="#1D4ED8" stroke-width="9" stroke-linecap="round"/><rect x="64" y="88" width="112" height="120" rx="16" fill="#2563EB"/><rect x="64" y="88" width="112" height="26" rx="13" fill="#1D4ED8"/></svg>`;

const WATCH = `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><rect x="104" y="42" width="32" height="52" rx="9" fill="#334155"/><rect x="104" y="146" width="32" height="52" rx="9" fill="#334155"/><circle cx="120" cy="120" r="48" fill="#0F172A"/><circle cx="120" cy="120" r="38" fill="#F1F5F9"/><path d="M120 120V98M120 120h18" stroke="#0F172A" stroke-width="4" stroke-linecap="round"/><circle cx="120" cy="120" r="4" fill="#D97706"/></svg>`;

const BOTTLE = `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><rect x="104" y="50" width="32" height="18" rx="4" fill="#0A7A52"/><path d="M100 68h40a10 10 0 0 1 10 10v100a16 16 0 0 1-16 16h-28a16 16 0 0 1-16-16V78a10 10 0 0 1 10-10Z" fill="#10B981"/><rect x="94" y="116" width="52" height="36" fill="#ECFDF5"/></svg>`;

const BOX = `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><path d="M120 58 188 96 120 134 52 96Z" fill="#FBBF24"/><path d="M52 96 120 134v66L52 162Z" fill="#B45309"/><path d="M188 96 120 134v66l68-38Z" fill="#F59E0B"/><path d="M120 60v74" stroke="#92400E" stroke-width="3"/></svg>`;

// ── Demo product records ─────────────────────────────────────────────────────────

export interface DemoProduct {
  id: string;
  name: string;
  price: string;
  oldPrice: string;
  discount: string;
  stock: string;
  image: string;
}

export const DEMO_PRODUCTS: Record<string, DemoProduct> = {
  tshirt: { id: "demo-tee", name: "Everyday Tee", price: "₹1,299", oldPrice: "₹1,699", discount: "24%", stock: "24", image: uri(TSHIRT) },
  headphones: { id: "demo-hp", name: "Studio Headphones", price: "₹4,499", oldPrice: "₹5,999", discount: "25%", stock: "18", image: uri(HEADPHONES) },
  bag: { id: "demo-bag", name: "Canvas Tote", price: "₹899", oldPrice: "₹1,199", discount: "20%", stock: "31", image: uri(BAG) },
  watch: { id: "demo-watch", name: "Minimal Watch", price: "₹3,299", oldPrice: "₹4,499", discount: "27%", stock: "12", image: uri(WATCH) },
  bottle: { id: "demo-bottle", name: "Steel Bottle", price: "₹699", oldPrice: "₹999", discount: "30%", stock: "40", image: uri(BOTTLE) },
  box: { id: "demo-box", name: "Gift Box", price: "₹1,999", oldPrice: "₹2,499", discount: "20%", stock: "9", image: uri(BOX) },
};

/** Which demo product a template category previews with. */
export const DEMO_BY_CATEGORY: Record<string, keyof typeof DEMO_PRODUCTS> = {
  NEW_ARRIVAL: "tshirt",
  NEW_STOCK: "headphones",
  RESTOCK: "bag",
  LIMITED_STOCK: "watch",
};

/** Builds the runtime context used to resolve {{product.*}} / {{shop.*}} tokens. */
export function demoContext(category: string): RenderContext {
  const key = DEMO_BY_CATEGORY[category] ?? "tshirt";
  const p = DEMO_PRODUCTS[key];
  return {
    product: { id: p.id, name: p.name, price: p.price, oldPrice: p.oldPrice, discount: p.discount, stock: p.stock, image: p.image },
    shop: { name: "Your Shop" },
    customer: { name: "there" },
  };
}
