/**
 * controllers/notificationDesign.controller.ts — HTTP layer for design CRUD.
 * Validate → service call → respond. All routes require shopkeeper auth.
 */

import type { Request, Response } from "express";
import { parseBody } from "../utils/validate.js";
import {
  CreateDesignSchema,
  PatchDesignSchema,
  ValidateDesignSchema,
  ListDesignsQuerySchema,
} from "../schemas/notificationRequests.schema.js";
import {
  createBlankDesign,
  getDesign as getDesignService,
  listDesigns as listDesignsService,
  autosaveDesign as autosaveDesignService,
  duplicateDesign as duplicateDesignService,
  createVersion as createVersionService,
  archiveDesign as archiveDesignService,
  restoreDesign as restoreDesignService,
} from "../services/notificationDesign.service.js";
import { useTemplate } from "../services/notificationTemplate.service.js";
import { validateDesign as validateDesignService } from "../services/notificationValidation.service.js";
import { handleControllerError, requireIdParam } from "./notificationResponse.js";

// POST /api/notifications/designs — blank design, or seeded from a templateId.
export async function createDesign(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, CreateDesignSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  try {
    const shopkeeperId = req.shopkeeperId!;
    const { name, category, templateId } = parsed.data;
    const design = templateId
      ? await useTemplate(shopkeeperId, templateId)
      : await createBlankDesign(shopkeeperId, name, category);
    res.status(201).json({ data: design, message: "Design created" });
  } catch (err) {
    handleControllerError(res, err, "Failed to create design");
  }
}

// GET /api/notifications/designs
export async function listDesigns(req: Request, res: Response): Promise<void> {
  const parsed = ListDesignsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query" });
    return;
  }
  try {
    const { archived, status, page, limit } = parsed.data;
    const result = await listDesignsService(req.shopkeeperId!, {
      archived: archived === undefined ? undefined : archived === "true",
      status,
      page,
      limit,
    });
    res.json({ data: result });
  } catch (err) {
    handleControllerError(res, err, "Failed to list designs");
  }
}

// GET /api/notifications/designs/:id
export async function getDesign(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const design = await getDesignService(req.shopkeeperId!, id);
    res.json({ data: design });
  } catch (err) {
    handleControllerError(res, err, "Failed to fetch design");
  }
}

// PATCH /api/notifications/designs/:id — autosave
export async function autosaveDesign(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, PatchDesignSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid design" });
    return;
  }
  try {
    const id = requireIdParam(req.params.id);
    const result = await autosaveDesignService(req.shopkeeperId!, id, parsed.data);
    res.json({ data: result, message: "Saved" });
  } catch (err) {
    handleControllerError(res, err, "Failed to save design");
  }
}

// POST /api/notifications/designs/:id/duplicate
export async function duplicateDesign(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const design = await duplicateDesignService(req.shopkeeperId!, id);
    res.status(201).json({ data: design, message: "Design duplicated" });
  } catch (err) {
    handleControllerError(res, err, "Failed to duplicate design");
  }
}

// POST /api/notifications/designs/:id/versions
export async function createDesignVersion(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const result = await createVersionService(req.shopkeeperId!, id);
    res.status(201).json({ data: result, message: "Version saved" });
  } catch (err) {
    handleControllerError(res, err, "Failed to save version");
  }
}

// POST /api/notifications/designs/:id/archive
export async function archiveDesign(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const result = await archiveDesignService(req.shopkeeperId!, id);
    res.json({ data: result, message: "Design archived" });
  } catch (err) {
    handleControllerError(res, err, "Failed to archive design");
  }
}

// POST /api/notifications/designs/:id/restore
export async function restoreDesign(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const result = await restoreDesignService(req.shopkeeperId!, id);
    res.json({ data: result, message: "Design restored" });
  } catch (err) {
    handleControllerError(res, err, "Failed to restore design");
  }
}

// POST /api/notifications/validate-design
export async function validateDesign(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, ValidateDesignSchema);
  if (!parsed.ok) {
    // Surface the design issues rather than a generic message.
    const result = validateDesignService((req.body as { design?: unknown })?.design);
    res.status(400).json({
      data: result.valid ? { valid: true } : { valid: false, issues: result.issues },
      message: "Invalid design",
    });
    return;
  }
  res.json({ data: { valid: true }, message: "Design is valid" });
}
