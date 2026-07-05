import type { NextFunction, Request, Response } from "express";
import { verifyCustomerToken, verifyShopkeeperToken } from "../utils/jwt.js";

/**
 * requireAnyAuth — accepts either a customer or a shopkeeper bearer token.
 *
 * Tries the customer token first, falls back to shopkeeper. On success,
 * attaches whichever of req.customerId / req.shopkeeperId matched (the
 * Express.Request augmentation for both already exists via
 * customerAuth.ts / shopkeeperAuth.ts). Used by routes reachable by both
 * roles, e.g. room chat.
 */
export function requireAnyAuth(
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

  try {
    req.customerId = verifyCustomerToken(token).sub;
    next();
    return;
  } catch {
    // not a customer token — fall through to shopkeeper
  }

  try {
    req.shopkeeperId = verifyShopkeeperToken(token).sub;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
