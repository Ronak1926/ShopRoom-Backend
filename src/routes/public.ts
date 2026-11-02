import { Router } from "express";
import { contactHandler, newsletterHandler } from "../controllers/publicForms.controller.js";
import { contactLimiter, newsletterLimiter } from "../middleware/rateLimiters.js";

export const publicRouter = Router();

publicRouter.post("/contact", contactLimiter, contactHandler);
publicRouter.post("/newsletter", newsletterLimiter, newsletterHandler);
