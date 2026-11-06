import { Router } from "express";
import { contactHandler, newsletterHandler, newsletterUnsubscribeHandler } from "../controllers/publicForms.controller.js";
import { contactLimiter, newsletterLimiter, newsletterUnsubscribeLimiter } from "../middleware/rateLimiters.js";

export const publicRouter = Router();

publicRouter.post("/contact", contactLimiter, contactHandler);
publicRouter.post("/newsletter", newsletterLimiter, newsletterHandler);
publicRouter.post("/newsletter/unsubscribe", newsletterUnsubscribeLimiter, newsletterUnsubscribeHandler);
