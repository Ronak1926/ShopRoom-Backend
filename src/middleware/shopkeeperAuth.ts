import type { NextFunction, Request, Response } from "express";
import { verifyShopkeeperToken } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      shopkeeperId?: string;
    }
  }
}

/**
 * requireShopkeeperAuth — Express middleware that validates a shopkeeper JWT.
 *
 * On success: attaches `req.shopkeeperId` (the shopkeeper's DB id) and calls next().
 * On failure: responds 401 — never calls next().
 *
 * Usage:
 *   router.get("/shop/me", requireShopkeeperAuth, shopController.getMyShop);
 */
export function requireShopkeeperAuth(
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
    const payload = verifyShopkeeperToken(token);
    req.shopkeeperId = payload.sub;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
