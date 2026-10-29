import type { NextFunction, Request, Response } from "express";
import { verifyCustomerToken } from "../utils/jwt.js";
import { isSessionActive } from "../services/session.service.js";

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
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ message: "Missing Authorization header" });
    return;
  }

  const token = header.slice("bearer ".length).trim();

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
