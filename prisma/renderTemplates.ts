/**
 * prisma/renderTemplates.ts — Generic recursive renderer (preview tool).
 *
 * Re-seeds the catalog, then renders every stored template's composition tree
 * into a static HTML page WITHOUT any template-specific logic: it walks the
 * `elements` tree and renders each node from its own data (frame + style +
 * layout + content). This is the proof of requirement 19 — a fresh renderer
 * recreates the full visual from JSON alone. The app's React/Framer Motion
 * renderer will follow the same recursion.
 *
 * Run: npx tsx prisma/renderTemplates.ts   → writes ../../template-previews.html
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "../src/generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedNotifications } from "./notificationSeed.js";
import { SVG_ASSETS } from "./decorativeAssets.js";
import { MUI_ICON_PATHS } from "./muiIconPaths.js";
import { demoContext } from "./demoProducts.js";
import {
  resolveVariables,
  resolveProductImage,
  type RenderContext,
} from "../src/utils/variableResolver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Active runtime context for the card being rendered. In production the same
// resolver receives the shopkeeper's real product/shop context instead.
let ACTIVE_CTX: RenderContext = {};

// Real MUI icon shapes: render the actual Material path (currentColor) so the
// preview matches what the React app draws with @mui/icons-material.
function iconSvg(name?: string): string {
  const paths = name ? MUI_ICON_PATHS[name] : undefined;
  if (!paths) return "";
  const inner = paths.map((d) => `<path d="${d}"/>`).join("");
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// ── Loose composition types (shape read back from the Json column) ──────────────

interface Frame { x: number; y: number; width: number; height: number; rotation?: number; scaleX?: number; scaleY?: number; zIndex?: number }
interface Grad { type?: string; angle?: number; stops: { offset: number; color: string }[] }
interface Shadow { enabled?: boolean; x?: number; y?: number; blur?: number; spread?: number; color?: string; inset?: boolean }
interface Border { width?: number; color?: string; style?: string }
interface Style { color?: string; backgroundColor?: string; backgroundGradient?: Grad; opacity?: number; fontSize?: number; fontWeight?: number; letterSpacing?: number; textTransform?: string; textAlign?: string; borderRadius?: number; border?: Border; shadow?: Shadow; blur?: number; backdropBlur?: number; padding?: number | Record<string, number> }
type Pad = number | Record<string, number>;
interface Layout { direction?: string; gap?: number; align?: string; justify?: string; padding?: Pad }
interface Content { text?: string; label?: string; value?: string | number; icon?: string; variable?: string; source?: string }
interface AssetRef { type?: string; assetId?: string; url?: string }
interface Node { id: string; type: string; frame: Frame; style?: Style; layout?: Layout; content?: Content; asset?: AssetRef; children?: Node[] }
interface Background { type?: string; color?: string; gradient?: Grad }
interface Design { category?: string; canvas: { width: number; height: number; background?: Background }; elements: Node[] }

// ── CSS helpers ──────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
function resolveVars(s: unknown): string {
  return resolveVariables(String(s ?? ""), ACTIVE_CTX);
}
function gradientCss(g: Grad): string {
  const stops = g.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
  return g.type === "RADIAL" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${g.angle ?? 160}deg, ${stops})`;
}
function backgroundCss(bg?: Background): string {
  if (bg?.type === "GRADIENT" && bg.gradient) return gradientCss(bg.gradient);
  if (bg?.color) return bg.color;
  return "#F5F2FF";
}
function shadowCss(sh: Shadow): string {
  return `${sh.inset ? "inset " : ""}${sh.x ?? 0}px ${sh.y ?? 8}px ${sh.blur ?? 24}px ${sh.spread ?? 0}px ${sh.color ?? "rgba(15,23,42,0.14)"}`;
}
function paddingCss(p?: Pad): string {
  if (p == null) return "";
  if (typeof p === "number") return `padding:${p}px`;
  return `padding:${p.top ?? 0}px ${p.right ?? 0}px ${p.bottom ?? 0}px ${p.left ?? 0}px`;
}
const mapAlign = (a?: string) => (a === "start" ? "flex-start" : a === "end" ? "flex-end" : a === "stretch" ? "stretch" : "center");
const mapJustify = (j?: string) => (j === "start" ? "flex-start" : j === "end" ? "flex-end" : j === "between" ? "space-between" : j === "around" ? "space-around" : "center");

// ── Leaf content ──────────────────────────────────────────────────────────────

function renderLeaf(node: Node): string {
  const c = node.content ?? {};
  switch (node.type) {
    case "PRODUCT_IMAGE":
    case "IMAGE": {
      const variable = c.variable ?? (c.source === "DYNAMIC" ? c.text : undefined);
      const src = resolveProductImage(variable, ACTIVE_CTX);
      if (src) {
        return `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 16px 16px rgba(15,23,42,0.28))"/>`;
      }
      return `<div class="product">Product image</div>`;
    }
    case "ICON":
    case "AVATAR":
    case "LOGO":
      return iconSvg(c.icon);
    case "BUTTON":
      return `${esc(resolveVars(c.label ?? "Button"))}${c.icon ? ` <span>${iconSvg(c.icon)}</span>` : ""}`;
    case "CIRCLE":
    case "RECTANGLE":
    case "LINE":
    case "SHAPE":
    case "SPARKLE":
    case "DIVIDER":
    case "GRADIENT":
    case "PROGRESS_BAR":
      return "";
    default:
      return esc(resolveVars(c.text ?? c.label ?? c.value ?? ""));
  }
}

// ── Recursive node renderer ─────────────────────────────────────────────────────

function renderNode(node: Node, inFlow: boolean): string {
  const f = node.frame;
  const s = node.style ?? {};
  const d: string[] = ["box-sizing:border-box"];

  d.push(inFlow ? "position:relative" : "position:absolute");
  if (!inFlow) d.push(`left:${f.x}px`, `top:${f.y}px`);
  d.push(`width:${f.width}px`, `height:${f.height}px`, `z-index:${f.zIndex ?? 0}`);

  const tf: string[] = [];
  if (f.rotation) tf.push(`rotate(${f.rotation}deg)`);
  if (f.scaleX != null && f.scaleX !== 1) tf.push(`scaleX(${f.scaleX})`);
  if (f.scaleY != null && f.scaleY !== 1) tf.push(`scaleY(${f.scaleY})`);
  if (tf.length) d.push(`transform:${tf.join(" ")}`);

  if (s.backgroundGradient) d.push(`background:${gradientCss(s.backgroundGradient)}`);
  else if (s.backgroundColor) d.push(`background:${s.backgroundColor}`);
  if (s.borderRadius != null) d.push(`border-radius:${s.borderRadius}px`);
  if (s.border) d.push(`border:${s.border.width ?? 1}px ${s.border.style ?? "solid"} ${s.border.color ?? "rgba(255,255,255,0.3)"}`);
  if (s.shadow?.enabled) d.push(`box-shadow:${shadowCss(s.shadow)}`);
  if (s.opacity != null) d.push(`opacity:${s.opacity}`);
  if (s.blur) d.push(`filter:blur(${s.blur}px)`);
  if (s.backdropBlur) d.push(`backdrop-filter:blur(${s.backdropBlur}px)`, `-webkit-backdrop-filter:blur(${s.backdropBlur}px)`);
  if (s.color) d.push(`color:${s.color}`);
  if (s.fontSize) d.push(`font-size:${s.fontSize}px`);
  if (s.fontWeight) d.push(`font-weight:${s.fontWeight}`);
  if (s.letterSpacing) d.push(`letter-spacing:${s.letterSpacing}px`);
  if (s.textTransform) d.push(`text-transform:${s.textTransform}`);

  const pad = paddingCss(node.layout?.padding ?? s.padding);
  if (pad) d.push(pad);
  if (node.layout?.overflow) d.push(`overflow:${node.layout.overflow}`);

  // Decorations: SVG art (currentColor) or CSS-drawn atmosphere (glow/pedestal/shadow).
  if (node.type === "DECORATION" || node.type === "PARTICLES" || node.asset) {
    const aid = node.asset?.assetId ?? "";
    const c = s.color ?? "#FFFFFF";
    if (aid === "glow" || aid === "product-glow" || aid === "spotlight" || aid === "radial-light") {
      d.push(`background:radial-gradient(circle at 50% 45%, ${c}59 0%, ${c}24 46%, ${c}00 72%)`);
      return `<div style="${d.join(";")}"></div>`;
    }
    if (aid === "pedestal" || aid === "platform") {
      d.push("border-radius:50%", `background:${c}`, "box-shadow:inset 0 6px 12px rgba(255,255,255,0.3),0 12px 22px -8px rgba(15,23,42,0.28)");
      return `<div style="${d.join(";")}"></div>`;
    }
    if (aid === "product-shadow") {
      d.push("border-radius:50%", "background:rgba(15,23,42,0.18)", "filter:blur(9px)");
      return `<div style="${d.join(";")}"></div>`;
    }
    return `<div style="${d.join(";")}">${SVG_ASSETS[aid] ?? ""}</div>`;
  }

  const children = node.children ?? [];
  let inner: string;
  if (children.length) {
    const lay = node.layout;
    if (lay?.direction) {
      d.push("display:flex", `flex-direction:${lay.direction}`, `align-items:${mapAlign(lay.align)}`, `justify-content:${mapJustify(lay.justify)}`);
      if (lay.gap != null) d.push(`gap:${lay.gap}px`);
      inner = children.map((c) => renderNode(c, true)).join("");
    } else {
      inner = children.map((c) => renderNode(c, false)).join("");
    }
  } else {
    const ta = s.textAlign ?? "center";
    d.push("display:flex", "align-items:center", `justify-content:${ta === "right" ? "flex-end" : ta === "left" ? "flex-start" : "center"}`, `text-align:${ta}`, "overflow:hidden", "gap:6px");
    inner = renderLeaf(node);
  }
  return `<div style="${d.join(";")}">${inner}</div>`;
}

function renderCard(name: string, category: string, design: Design): string {
  // Resolve this card's variables against demo product context (production
  // would pass the shopkeeper's real product/shop context here instead).
  ACTIVE_CTX = demoContext(design.category ?? "");
  const { width, height, background } = design.canvas;
  const els = design.elements.map((n) => renderNode(n, false)).join("");
  return `
    <figure class="card">
      <div class="tpl-name">${esc(category)}</div>
      <div class="screen" style="width:${width}px;height:${height}px;background:${backgroundCss(background)}">${els}</div>
    </figure>`;
}

const PAGE = (cards: string, count: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ShopRoom — Notification Templates (${count})</title>
<style>
  * { margin:0; box-sizing:border-box; }
  body { font-family:"Manrope","Segoe UI",system-ui,sans-serif; background:#F8F9FC; color:#0F172A; padding:40px 24px; }
  header { max-width:1200px; margin:0 auto 28px; }
  header h1 { font-size:24px; font-weight:800; }
  header p { color:#55596E; margin-top:6px; font-size:14px; max-width:760px; }
  .grid { max-width:1280px; margin:0 auto; display:grid; gap:28px 24px;
          grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); justify-items:center; }
  .card { display:flex; flex-direction:column; align-items:center; }
  .tpl-name { font-size:12px; font-weight:800; letter-spacing:.06em; color:#5B47D4; margin-bottom:12px; }
  .screen { position:relative; overflow:hidden; border-radius:24px;
            box-shadow:0 24px 50px -18px rgba(15,23,42,.28); border:1px solid rgba(15,23,42,.06); }
  .product { width:100%; height:100%; border-radius:16px; background:#FFFFFF; color:#94A3B8;
             display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; }
</style></head>
<body>
  <header>
    <h1>ShopRoom — Notification Templates</h1>
    <p>${count} template(s), rendered by a generic recursive renderer straight from the stored composition JSON — no template-specific code. Product slots show a placeholder; the shopkeeper's uploaded image renders there at send time.</p>
  </header>
  <div class="grid">${cards}</div>
</body></html>`;

async function main() {
  await seedNotifications(prisma);

  const templates = await prisma.notificationTemplate.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { name: true, designJson: true, category: { select: { name: true } } },
  });

  const cards = templates
    .map((t) => renderCard(t.name, t.category?.name ?? "", t.designJson as unknown as Design))
    .join("");

  const out = resolve(__dirname, "../../template-previews.html");
  writeFileSync(out, PAGE(cards, templates.length), "utf-8");
  console.log(`✅  Wrote ${templates.length} template preview(s) → ${out}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
