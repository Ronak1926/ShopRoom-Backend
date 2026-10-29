import type { Request, Response } from "express";
import { parseBody } from "../utils/validate.js";
import {
  CreateScheduleSchema,
  ListSchedulesQuerySchema,
  UpdateScheduleStatusSchema,
} from "../schemas/notificationScheduleRequest.schema.js";
import {
  cancelSchedule,
  createSchedule,
  listSchedules,
  setScheduleStatus,
} from "../services/notificationSchedule.service.js";
import { handleControllerError, requireIdParam } from "./notificationResponse.js";

// POST /api/notifications/schedules
export async function createScheduleHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, CreateScheduleSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const result = await createSchedule(req.shopkeeperId!, parsed.data);
    res.status(201).json({ data: result, message: "Notification scheduled" });
  } catch (err) {
    handleControllerError(res, err, "Failed to schedule notification");
  }
}

// GET /api/notifications/schedules?state=upcoming|completed
export async function listSchedulesHandler(req: Request, res: Response): Promise<void> {
  const query = ListSchedulesQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  try {
    const result = await listSchedules(req.shopkeeperId!, query.data);
    res.json({ data: result });
  } catch (err) {
    handleControllerError(res, err, "Failed to load schedules");
  }
}

// PATCH /api/notifications/schedules/:id — pause or resume
export async function updateScheduleStatusHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, UpdateScheduleStatusSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  try {
    const id = requireIdParam(req.params.id);
    const result = await setScheduleStatus(req.shopkeeperId!, id, parsed.data.status);
    res.json({ data: result });
  } catch (err) {
    handleControllerError(res, err, "Failed to update schedule");
  }
}

// DELETE /api/notifications/schedules/:id — cancel
export async function cancelScheduleHandler(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    await cancelSchedule(req.shopkeeperId!, id);
    res.json({ message: "Schedule cancelled" });
  } catch (err) {
    handleControllerError(res, err, "Failed to cancel schedule");
  }
}
