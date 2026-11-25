import type { NextFunction, Request, Response } from "express";
import { verifyCustomerToken, verifyShopkeeperToken } from "../utils/jwt.js";
import { isSessionActive } from "../services/session.service.js";
import { anyTokens } from "./sessionToken.js";

function tryVerify<T>(verify: (token: string) => T, token: string): T | null {
  try {
    return verify(token);
  } catch {
    return null;
  }
}

/**
 * requireAnyAuth — accepts either a customer or a shopkeeper bearer token.
 *
 * Tries the customer token first, falls back to shopkeeper. On success,
 * attaches whichever of req.customerId / req.shopkeeperId matched (the
 * Express.Request augmentation for both already exists via
 * customerAuth.ts / shopkeeperAuth.ts). Used by routes reachable by both
 * roles, e.g. room chat.
 */
export async function requireAnyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const found = anyTokens(req);
  if ("rejected" in found) {
    if (found.rejected === "cross-site") res.status(403).json({ message: "This request is not allowed from this origin" });
    else res.status(401).json({ message: "Missing Authorization header" });
    return;
  }

  // A header token is tried as either role; a cookie is already tied to its role.
  for (const { token, role } of found.tokens) {
    const customer = role === "shopkeeper" ? null : tryVerify(verifyCustomerToken, token);
    if (customer) {
      if (await isSessionActive("customer", customer.sub, customer.tv)) {
        req.customerId = customer.sub;
        next();
        return;
      }
      continue;
    }
    const shopkeeper = role === "customer" ? null : tryVerify(verifyShopkeeperToken, token);
    if (shopkeeper && (await isSessionActive("shopkeeper", shopkeeper.sub, shopkeeper.tv))) {
      req.shopkeeperId = shopkeeper.sub;
      next();
      return;
    }
  }
  res.status(401).json({ message: "Invalid or expired token" });
}
