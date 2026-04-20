import type { NextFunction, Request, Response } from "express";
import { verifyCustomerToken } from "../utils/jwt.js";

declare global {
  namespace Express {
    interface Request {
      customerId?: string;
    }
  }
}

export function requireCustomerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ message: "Missing Authorization header" });
  }

  const token = header.slice("bearer ".length).trim();

  try {
    const payload = verifyCustomerToken(token);
    req.customerId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
