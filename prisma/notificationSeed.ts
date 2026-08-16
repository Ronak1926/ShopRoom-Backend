/**
 * prisma/notificationSeed.ts — Seeds the notification catalog: semantic
 * categories, the animation library, and the NEW_ARRIVAL starter template
 * authored as a full v2 composition tree. Idempotent (upsert by slug).
 *
 * Only NEW_ARRIVAL is authored for now — the remaining ShopRoom templates are
 * added once the generic composition engine renders and edits it end to end.
 * Any older (v1) templates are deactivated so listings stay consistent.
 */

import type { PrismaClient } from "../src/generated/client.js";
import { toJsonInput } from "../src/utils/notificationDesign.js";
import { TEMPLATES } from "./notificationTemplates.js";

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES: { slug: string; name: string; icon: string }[] = [
  { slug: "new-arrival", name: "New Arrival", icon: "auto_awesome" },
  { slug: "new-stock", name: "New Stock", icon: "inventory_2" },
  { slug: "restock", name: "Restock", icon: "restart_alt" },
  { slug: "limited-stock", name: "Limited Stock", icon: "hourglass_bottom" },
  { slug: "sale", name: "Sale", icon: "sell" },
  { slug: "flash-sale", name: "Flash Sale", icon: "bolt" },
  { slug: "offer", name: "Offer", icon: "local_offer" },
  { slug: "event", name: "Event", icon: "event" },
  { slug: "announcement", name: "Announcement", icon: "campaign" },
  { slug: "reminder", name: "Reminder", icon: "notifications_active" },
  { slug: "custom", name: "Custom", icon: "tune" },
];

// ── Animations ────────────────────────────────────────────────────────────────

type AnimCat = "ENTRY" | "ATTENTION" | "CLICK" | "EXIT";
const ANIMATIONS: { slug: string; name: string; type: string; category: AnimCat; requiredPlan: string | null }[] = [
  { slug: "fade-in", name: "Fade In", type: "FADE_IN", category: "ENTRY", requiredPlan: null },
  { slug: "slide-up", name: "Slide Up", type: "SLIDE_UP", category: "ENTRY", requiredPlan: null },
  { slug: "slide-down", name: "Slide Down", type: "SLIDE_DOWN", category: "ENTRY", requiredPlan: null },
  { slug: "slide-left", name: "Slide Left", type: "SLIDE_LEFT", category: "ENTRY", requiredPlan: null },
  { slug: "slide-right", name: "Slide Right", type: "SLIDE_RIGHT", category: "ENTRY", requiredPlan: null },
  { slug: "zoom-in", name: "Zoom In", type: "ZOOM_IN", category: "ENTRY", requiredPlan: null },
  { slug: "bounce-in", name: "Bounce In", type: "BOUNCE_IN", category: "ENTRY", requiredPlan: "3m" },
  { slug: "pulse", name: "Pulse", type: "PULSE", category: "ATTENTION", requiredPlan: null },
  { slug: "shake", name: "Shake", type: "SHAKE", category: "ATTENTION", requiredPlan: null },
  { slug: "glow", name: "Glow", type: "GLOW", category: "ATTENTION", requiredPlan: null },
  { slug: "wiggle", name: "Wiggle", type: "WIGGLE", category: "ATTENTION", requiredPlan: null },
  { slug: "bounce", name: "Bounce", type: "BOUNCE", category: "ATTENTION", requiredPlan: null },
  { slug: "ripple", name: "Ripple", type: "RIPPLE", category: "CLICK", requiredPlan: null },
  { slug: "pop", name: "Pop", type: "POP", category: "CLICK", requiredPlan: null },
  { slug: "scale", name: "Scale", type: "SCALE", category: "CLICK", requiredPlan: null },
  { slug: "rotate", name: "Rotate", type: "ROTATE", category: "CLICK", requiredPlan: null },
  { slug: "confetti", name: "Confetti", type: "CONFETTI", category: "CLICK", requiredPlan: "3m" },
  { slug: "fade-out", name: "Fade Out", type: "FADE_OUT", category: "EXIT", requiredPlan: null },
];

// ── Runner ────────────────────────────────────────────────────────────────────

export async function seedNotifications(prisma: PrismaClient): Promise<void> {
  const categoryIdBySlug = new Map<string, string>();
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    const row = await prisma.notificationCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name, icon: c.icon, sortOrder: i, isActive: true },
      create: { slug: c.slug, name: c.name, icon: c.icon, sortOrder: i },
      select: { id: true },
    });
    categoryIdBySlug.set(c.slug, row.id);
  }

  for (let i = 0; i < ANIMATIONS.length; i++) {
    const a = ANIMATIONS[i];
    await prisma.notificationAnimation.upsert({
      where: { slug: a.slug },
      update: { name: a.name, type: a.type, category: a.category, requiredPlan: a.requiredPlan, sortOrder: i, isActive: true },
      create: { slug: a.slug, name: a.name, type: a.type, category: a.category, requiredPlan: a.requiredPlan, sortOrder: i, configSchema: { durationMs: 400, easing: "easeOut" } },
    });
  }

  const activeSlugs: string[] = [];
  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i];
    const categoryId = categoryIdBySlug.get(t.categorySlug);
    if (!categoryId) continue;
    const designJson = toJsonInput(t.build());
    await prisma.notificationTemplate.upsert({
      where: { slug: t.slug },
      update: { name: t.name, categoryId, designJson, schemaVersion: 2, sortOrder: i, isActive: true },
      create: { slug: t.slug, name: t.name, categoryId, designJson, schemaVersion: 2, sortOrder: i },
    });
    activeSlugs.push(t.slug);
  }

  // Deactivate any older (v1) templates so listings only surface v2 designs.
  await prisma.notificationTemplate.updateMany({
    where: { slug: { notIn: activeSlugs } },
    data: { isActive: false },
  });

  console.log(
    `✅  Notifications: ${CATEGORIES.length} categories, ${ANIMATIONS.length} animations, ${TEMPLATES.length} v2 template(s)`,
  );
}
