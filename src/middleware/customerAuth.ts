import type { NextFunction, Request, Response } from "express";
import { verifyCustomerToken } from "../utils/jwt.js";
import { isSessionActive } from "../services/session.service.js";
import { tokenFor } from "./sessionToken.js";

declare global {
  namespace Express {
    interface Request {
      customerId?: string;
    }
  }
}

export async function requireCustomerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const source = tokenFor(req, "customer");
  if ("rejected" in source) {
    if (source.rejected === "cross-site") res.status(403).json({ message: "This request is not allowed from this origin" });
    else res.status(401).json({ message: "Missing Authorization header" });
    return;
  }
  const token = source.token;

  let payload;
  try {
    payload = verifyCustomerToken(token);
  } catch {
    res.status(401).json({ message: "Invalid token" });
    return;
  }

  if (!(await isSessionActive("customer", payload.sub, payload.tv))) {
    res.status(401).json({ message: "Invalid token" });
    return;
  }

  req.customerId = payload.sub;
  next();
}
