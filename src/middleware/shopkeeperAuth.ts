import type { NextFunction, Request, Response } from "express";
import { verifyShopkeeperToken } from "../lib/jwt.js";
import { isSessionActive } from "../services/session.service.js";
import { tokenFor } from "./sessionToken.js";

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
 * On failure: responds 401 — never calls next(). A correctly signed token is
 * still rejected once the account is deleted or its sessions were revoked.
 *
 * Usage:
 *   router.get("/shop/me", requireShopkeeperAuth, shopController.getMyShop);
 */
export async function requireShopkeeperAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const source = tokenFor(req, "shopkeeper");
  if ("rejected" in source) {
    if (source.rejected === "cross-site") res.status(403).json({ message: "This request is not allowed from this origin" });
    else res.status(401).json({ message: "Missing Authorization header" });
    return;
  }
  const token = source.token;

  let payload;
  try {
    payload = verifyShopkeeperToken(token);
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  if (!(await isSessionActive("shopkeeper", payload.sub, payload.tv))) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  req.shopkeeperId = payload.sub;
  next();
}
