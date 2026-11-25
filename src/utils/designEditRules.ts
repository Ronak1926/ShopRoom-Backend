/**
 * utils/designEditRules.ts — What a plan may change when it saves a design.
 *
 * 1 Month plans get quick edit: the words and the photos of a template, and
 * nothing else. Everything else — which elements exist, where they sit, how
 * they look and move — must match the design as it was before the save.
 *
 * Plans without custom animation (1 and 2 Months) keep every existing
 * element's animation exactly as it is, and add new elements without one.
 *
 * Both checks compare the incoming design with the stored one, so a
 * shopkeeper can keep quick-editing a design for as long as they like but
 * can never step outside it, whatever the client sends.
 */

import type { CompositionNode, NotificationDesign } from "../schemas/notification.schema.js";

type Json = unknown;

/** JSON with object keys sorted, so equal values always serialise equally. */
function stable(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, Json>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A node with the quick-editable parts (words, photo source and framing) removed. */
function lockedPart(node: CompositionNode): Json {
  const { content, asset, image, children, ...rest } = node;
  const lockedContent = content ? (({ text: _t, label: _l, ...other }) => other)(content) : undefined;
  const isPhoto = asset?.type === "IMAGE";
  const lockedAsset = asset && isPhoto
    ? (({ url: _u, attribution: _a, naturalWidth: _w, naturalHeight: _h, ...other }) => other)(asset)
    : asset;
  const lockedImage = image && isPhoto ? (({ crop: _c, position: _p, ...other }) => other)(image) : image;
  return {
    ...rest,
    content: lockedContent,
    asset: lockedAsset,
    image: lockedImage,
    children: children?.map(lockedPart),
  };
}

/** The parts of a design a quick edit may not touch. */
function lockedDesign(design: NotificationDesign): Json {
  return {
    category: design.category,
    canvas: design.canvas,
    designTokens: design.designTokens,
    globalAnimation: design.globalAnimation,
    timeline: design.timeline,
    elements: design.elements.map(lockedPart),
  };
}

export const QUICK_EDIT_MESSAGE =
  "Your 1 Month plan includes quick edit: change the words and photos of a template. Upgrade to 2 Months for the full editor.";

/** Null when `next` only changes words and photos of `prev`; otherwise why not. */
export function quickEditViolation(prev: NotificationDesign, next: NotificationDesign): string | null {
  return stable(lockedDesign(prev)) === stable(lockedDesign(next)) ? null : QUICK_EDIT_MESSAGE;
}

function collect(nodes: CompositionNode[], into = new Map<string, CompositionNode>()) {
  for (const n of nodes) {
    into.set(n.id, n);
    if (n.children) collect(n.children, into);
  }
  return into;
}

function hasSteps(animation: CompositionNode["animation"]): boolean {
  return !!(animation && (animation.entry || animation.attention || animation.exit));
}

export const CUSTOM_ANIMATION_MESSAGE =
  "Custom animations are part of the 3 Months plan. Elements keep the animation their template came with.";

/** Null when no element's animation was added or changed; otherwise why not. */
export function animationEditViolation(prev: NotificationDesign, next: NotificationDesign): string | null {
  if (stable(prev.globalAnimation) !== stable(next.globalAnimation)) return CUSTOM_ANIMATION_MESSAGE;
  const before = collect(prev.elements);
  for (const node of collect(next.elements).values()) {
    const old = before.get(node.id);
    const changed = old ? stable(old.animation ?? null) !== stable(node.animation ?? null) : hasSteps(node.animation);
    if (changed) return CUSTOM_ANIMATION_MESSAGE;
  }
  return null;
}
