/**
 * controllers/notificationTemplate.controller.ts — HTTP layer for templates.
 */

import type { Request, Response } from "express";
import {
  listTemplates as listTemplatesService,
  getTemplate as getTemplateService,
  useTemplate as useTemplateService,
} from "../services/notificationTemplate.service.js";
import { handleControllerError, requireIdParam } from "./notificationResponse.js";

// GET /api/notifications/templates?categoryId=
export async function listTemplates(req: Request, res: Response): Promise<void> {
  try {
    const categoryId =
      typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
    const templates = await listTemplatesService(categoryId);
    res.set("Cache-Control", "private, max-age=60");
    res.json({ data: templates });
  } catch (err) {
    handleControllerError(res, err, "Failed to list templates");
  }
}

// GET /api/notifications/templates/:id
export async function getTemplate(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const template = await getTemplateService(id);
    res.json({ data: template });
  } catch (err) {
    handleControllerError(res, err, "Failed to fetch template");
  }
}

// POST /api/notifications/templates/:id/use — clone into an owned design
export async function useTemplate(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const design = await useTemplateService(req.shopkeeperId!, id);
    res.status(201).json({ data: design, message: "Template cloned" });
  } catch (err) {
    handleControllerError(res, err, "Failed to use template");
  }
}
