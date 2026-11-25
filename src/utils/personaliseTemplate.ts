/**
 * utils/personaliseTemplate.ts — Puts the shopkeeper's own shop name into a
 * template's sample design, so a 1 Month (quick edit) shop never sends another
 * shop's name, and nobody has to retype their own.
 *
 * Templates show the shop name in three ways: a pill (node "shop" holding
 * "shop-initial" and "shop-name"), the full name inside other words ("Riya
 * Boutique · Combo"), and a shortened form in small uppercase labels. All three
 * are rewritten; the pill is resized to the new name.
 */

import type { CompositionNode, NotificationDesign } from "../schemas/notification.schema.js";

/** A shop name for small labels: its first words that fit in 15 characters. */
export function compactShopName(shop: string): string {
  const words = shop.trim().split(/\s+/);
  let out = words[0] ?? "";
  for (const w of words.slice(1)) {
    if (`${out} ${w}`.length > 15) break;
    out = `${out} ${w}`;
  }
  return out;
}

/** Width of the shop pill for a name, matching prisma/templates/kit.ts (capped so it can't cover the banner). */
export const SHOP_CHIP_MAX_WIDTH = 180;
export function shopChipWidth(name: string): number {
  return Math.min(SHOP_CHIP_MAX_WIDTH, Math.ceil(name.length * 6.2) + 34);
}

function replaceAll(text: string, pairs: [string, string][]): string {
  return pairs.reduce((acc, [from, to]) => (from && from !== to ? acc.split(from).join(to) : acc), text);
}

function personaliseNode(node: CompositionNode, shopName: string, pairs: [string, string][]): CompositionNode {
  const next: CompositionNode = { ...node };
  if (node.content) {
    next.content = { ...node.content };
    if (node.id === "shop-initial") next.content.text = shopName.charAt(0).toUpperCase();
    else {
      if (typeof node.content.text === "string") next.content.text = replaceAll(node.content.text, pairs);
      if (typeof node.content.label === "string") next.content.label = replaceAll(node.content.label, pairs);
    }
  }
  if (node.id === "shop") {
    // The pill was sized to the sample name; size it to the real one. A pill
    // that sat against the right edge stays against it.
    const width = shopChipWidth(shopName);
    const rightAligned = node.frame.x + node.frame.width >= 360;
    next.frame = { ...node.frame, width, x: rightAligned ? node.frame.x + node.frame.width - width : node.frame.x };
    next.children = node.children?.map((child) =>
      child.id === "shop-name"
        ? { ...personaliseNode(child, shopName, pairs), frame: { ...child.frame, width: width - 34 }, style: { ...child.style, overflow: "ellipsis" } }
        : personaliseNode(child, shopName, pairs),
    );
    return next;
  }
  if (node.children) next.children = node.children.map((child) => personaliseNode(child, shopName, pairs));
  return next;
}

/** The design with `sample` (and its short form) replaced by `shopName` everywhere. */
export function personaliseTemplate(design: NotificationDesign, sample: string | null | undefined, shopName: string | null | undefined): NotificationDesign {
  const real = shopName?.trim();
  if (!sample || !real || sample === real) return design;
  const pairs: [string, string][] = [[sample, real]];
  const shortSample = compactShopName(sample);
  // Only the shortened form when it differs and is distinctive enough not to hit ordinary words.
  if (shortSample !== sample && shortSample.length >= 4) pairs.push([shortSample, compactShopName(real)]);
  return { ...design, elements: design.elements.map((n) => personaliseNode(n, real, pairs)) };
}
