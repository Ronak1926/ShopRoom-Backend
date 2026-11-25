/**
 * services/notificationTemplate.service.ts — CounterCircle-provided starting designs.
 *
 * A template is just an initial design. Cloning it produces a shopkeeper-owned
 * NotificationDesign; the template itself is never mutated (master plan §22).
 */

import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import { cloneDesignJson, toJsonInput } from "../utils/notificationDesign.js";
import { validateDesign } from "./notificationValidation.service.js";
import { meetsRequiredPlan } from "./notificationPlan.service.js";
import { personaliseTemplate } from "../utils/personaliseTemplate.js";

export interface ListTemplatesOptions {
  categoryId?: string;
  /** Only these templates (the Favourites tab); still paginated and active-only. */
  ids?: string[];
  q?: string;
  sort?: "popular" | "newest" | "name";
  page?: number;
  limit?: number;
}

/**
 * Paginated catalog listing.
 *
 * designJson IS included: thumbnailUrl is never populated, and the browser
 * renders each card through the same renderer the canvas uses, so previews stay
 * accurate without a screenshot pipeline to keep in sync. The page size is
 * capped at 24 upstream to keep the payload bounded.
 */
export async function listTemplates(options: ListTemplatesOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(24, Math.max(1, options.limit ?? 10));
  const q = options.q?.trim();

  const where = {
    isActive: true,
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
    ...(options.ids ? { id: { in: options.ids } } : {}),
    ...(q ?{ name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const orderBy =
    options.sort === "newest" ? [{ createdAt: "desc" as const }]
    : options.sort === "name" ? [{ name: "asc" as const }]
    : [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

  const [items, total] = await Promise.all([
    prisma.notificationTemplate.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        slug: true,
        name: true,
        categoryId: true,
        designJson: true,
        thumbnailUrl: true,
        requiredPlan: true,
        schemaVersion: true,
      },
    }),
    prisma.notificationTemplate.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getTemplate(id: string) {
  const template = await prisma.notificationTemplate.findFirst({
    where: { id, isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      categoryId: true,
      designJson: true,
      thumbnailUrl: true,
      schemaVersion: true,
      requiredPlan: true,
    },
  });
  if (!template) throw NotificationError.notFound("Template not found");
  return template;
}

/**
 * Clones a template into a new shopkeeper-owned design (source SHOPROOM_TEMPLATE),
 * seeding version 1. Enforces the template's requiredPlan against the owner's plan.
 */
export async function useTemplate(shopkeeperId: string, templateId: string) {
  const [template, shopkeeper] = await Promise.all([
    prisma.notificationTemplate.findFirst({
      where: { id: templateId, isActive: true },
      select: {
        id: true,
        name: true,
        categoryId: true,
        designJson: true,
        schemaVersion: true,
        requiredPlan: true,
        sampleShopName: true,
      },
    }),
    prisma.shopkeeper.findUnique({
      where: { id: shopkeeperId },
      select: { planType: true, shop: { select: { shopName: true } } },
    }),
  ]);

  if (!template) throw NotificationError.notFound("Template not found");
  if (!meetsRequiredPlan(shopkeeper?.planType, template.requiredPlan)) {
    throw NotificationError.forbidden(
      "This template is not available on your current plan",
    );
  }

  const validated = validateDesign(template.designJson);
  if (!validated.valid) {
    throw NotificationError.badRequest("Template design is invalid");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.notificationDesign.create({
      data: {
        shopkeeperId,
        sourceTemplateId: template.id,
        categoryId: template.categoryId,
        name: template.name,
        status: "DRAFT",
        schemaVersion: template.schemaVersion,
        designJson: toJsonInput(validated.data), // placeholder id, replaced below
      },
      select: { id: true },
    });

    const personalised = personaliseTemplate(validated.data, template.sampleShopName, shopkeeper?.shop?.shopName);
    const cloned = cloneDesignJson(personalised, {
      id: created.id,
      name: template.name,
      source: "SHOPROOM_TEMPLATE",
    });

    const design = await tx.notificationDesign.update({
      where: { id: created.id },
      data: { designJson: toJsonInput(cloned) },
    });

    await tx.notificationDesignVersion.create({
      data: {
        designId: created.id,
        version: 1,
        designJson: toJsonInput(cloned),
        createdBy: shopkeeperId,
      },
    });

    return design;
  });
}
