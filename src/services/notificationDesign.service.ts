/**
 * services/notificationDesign.service.ts — Shopkeeper-owned design lifecycle:
 * create, fetch, autosave, duplicate, version, archive, restore.
 *
 * Every query is scoped to the authenticated shopkeeper — a client-supplied id
 * never grants access to another owner's design (master plan §17).
 */

import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import {
  buildBlankDesign,
  cloneDesignJson,
  toJsonInput,
} from "../utils/notificationDesign.js";
import { validateDesign } from "./notificationValidation.service.js";
import type {
  NotificationDesign,
  NotificationType,
} from "../schemas/notification.schema.js";

// Lean projection returned to the editor.
const DESIGN_SELECT = {
  id: true,
  name: true,
  status: true,
  categoryId: true,
  sourceTemplateId: true,
  schemaVersion: true,
  version: true,
  isArchived: true,
  designJson: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function resolveCategoryId(
  category: NotificationType,
): Promise<string | null> {
  const slug = category.toLowerCase().replace(/_/g, "-");
  const cat = await prisma.notificationCategory.findUnique({
    where: { slug },
    select: { id: true },
  });
  return cat?.id ?? null;
}

/** Confirms the design exists and belongs to the shopkeeper; returns its id. */
async function assertOwned(shopkeeperId: string, id: string): Promise<void> {
  const owned = await prisma.notificationDesign.findFirst({
    where: { id, shopkeeperId },
    select: { id: true },
  });
  if (!owned) throw NotificationError.notFound("Design not found");
}

export async function createBlankDesign(
  shopkeeperId: string,
  name: string,
  category: NotificationType,
) {
  const categoryId = await resolveCategoryId(category);

  return prisma.$transaction(async (tx) => {
    const created = await tx.notificationDesign.create({
      data: {
        shopkeeperId,
        categoryId,
        name,
        status: "DRAFT",
        designJson: toJsonInput(buildBlankDesign({ id: "pending", name, category })),
      },
      select: { id: true },
    });

    const design = buildBlankDesign({ id: created.id, name, category });
    const row = await tx.notificationDesign.update({
      where: { id: created.id },
      data: { designJson: toJsonInput(design) },
      select: DESIGN_SELECT,
    });

    await tx.notificationDesignVersion.create({
      data: {
        designId: created.id,
        version: 1,
        designJson: toJsonInput(design),
        createdBy: shopkeeperId,
      },
    });

    return row;
  });
}

export async function getDesign(shopkeeperId: string, id: string) {
  const design = await prisma.notificationDesign.findFirst({
    where: { id, shopkeeperId },
    select: DESIGN_SELECT,
  });
  if (!design) throw NotificationError.notFound("Design not found");
  return design;
}

interface ListDesignsOptions {
  archived?: boolean;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  page: number;
  limit: number;
}

export async function listDesigns(
  shopkeeperId: string,
  { archived, status, page, limit }: ListDesignsOptions,
) {
  const where = {
    shopkeeperId,
    ...(archived === undefined ? {} : { isArchived: archived }),
    ...(status ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.notificationDesign.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: page * limit,
      select: {
        id: true,
        name: true,
        status: true,
        categoryId: true,
        version: true,
        isArchived: true,
        updatedAt: true,
      },
    }),
    prisma.notificationDesign.count({ where }),
  ]);

  return { items, total, page, limit };
}

interface AutosaveInput {
  name?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  design?: NotificationDesign;
}

/**
 * Optimistic autosave. Overwrites the working design JSON but does NOT snapshot
 * a version — versions are created explicitly. The stored id is authoritative,
 * so a client can never repoint a design by editing the embedded id.
 */
export async function autosaveDesign(
  shopkeeperId: string,
  id: string,
  input: AutosaveInput,
) {
  await assertOwned(shopkeeperId, id);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.status !== undefined) data.status = input.status;
  if (input.design) {
    const stamped: NotificationDesign = {
      ...input.design,
      id,
      metadata: {
        ...input.design.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
    data.designJson = toJsonInput(stamped);
  }

  const row = await prisma.notificationDesign.update({
    where: { id },
    data,
    select: { id: true, name: true, status: true, version: true, updatedAt: true },
  });
  return row;
}

export async function duplicateDesign(shopkeeperId: string, id: string) {
  const source = await prisma.notificationDesign.findFirst({
    where: { id, shopkeeperId },
    select: {
      designJson: true,
      name: true,
      categoryId: true,
      schemaVersion: true,
    },
  });
  if (!source) throw NotificationError.notFound("Design not found");

  const validated = validateDesign(source.designJson);
  if (!validated.valid) {
    throw NotificationError.badRequest("Stored design is invalid");
  }
  const copyName = `${source.name} (copy)`.slice(0, 120);

  return prisma.$transaction(async (tx) => {
    const created = await tx.notificationDesign.create({
      data: {
        shopkeeperId,
        categoryId: source.categoryId,
        name: copyName,
        status: "DRAFT",
        schemaVersion: source.schemaVersion,
        designJson: toJsonInput(validated.data),
      },
      select: { id: true },
    });

    const cloned = cloneDesignJson(validated.data, {
      id: created.id,
      name: copyName,
      source: "DUPLICATED",
    });

    const row = await tx.notificationDesign.update({
      where: { id: created.id },
      data: { designJson: toJsonInput(cloned) },
      select: DESIGN_SELECT,
    });

    await tx.notificationDesignVersion.create({
      data: {
        designId: created.id,
        version: 1,
        designJson: toJsonInput(cloned),
        createdBy: shopkeeperId,
      },
    });

    return row;
  });
}

/** Snapshots the current working design as the next immutable version. */
export async function createVersion(shopkeeperId: string, id: string) {
  const design = await prisma.notificationDesign.findFirst({
    where: { id, shopkeeperId },
    select: { designJson: true, version: true },
  });
  if (!design) throw NotificationError.notFound("Design not found");

  const validated = validateDesign(design.designJson);
  if (!validated.valid) {
    throw NotificationError.badRequest("Stored design is invalid");
  }
  const nextVersion = design.version + 1;

  return prisma.$transaction(async (tx) => {
    await tx.notificationDesignVersion.create({
      data: {
        designId: id,
        version: nextVersion,
        designJson: toJsonInput(validated.data),
        createdBy: shopkeeperId,
      },
    });
    await tx.notificationDesign.update({
      where: { id },
      data: { version: nextVersion },
    });
    return { id, version: nextVersion };
  });
}

export async function archiveDesign(shopkeeperId: string, id: string) {
  await assertOwned(shopkeeperId, id);
  return prisma.notificationDesign.update({
    where: { id },
    data: { isArchived: true, status: "ARCHIVED" },
    select: { id: true, status: true, isArchived: true },
  });
}

export async function restoreDesign(shopkeeperId: string, id: string) {
  await assertOwned(shopkeeperId, id);
  return prisma.notificationDesign.update({
    where: { id },
    data: { isArchived: false, status: "DRAFT" },
    select: { id: true, status: true, isArchived: true },
  });
}
