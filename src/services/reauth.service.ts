/**
 * services/reauth.service.ts — "Prove it's really you" for actions too sensitive to rest on a
 * session alone (deleting an account, downloading all of its data).
 */

import { prisma } from "../database/prisma.js";
import { firebaseAuth } from "../lib/firebaseAdmin.js";
import { verifyPassword } from "../utils/password.js";
import { getCustomerAuthFactors } from "./customers.service.js";

/** A Google sign-in counts as proof only if it happened this recently. */
const REAUTH_WINDOW_SECONDS = 5 * 60;

export type Reauthentication = "confirmed" | "denied" | "not-found";

/** Password for accounts that have one; otherwise a fresh Google ID token for the linked Google account. */
export async function confirmCustomerIdentity(customerId: string, proof: { password?: string; idToken?: string }): Promise<Reauthentication> {
  const factors = await getCustomerAuthFactors(customerId);
  if (!factors) return "not-found";

  if (factors.passwordHash) {
    return typeof proof.password === "string" && (await verifyPassword(proof.password, factors.passwordHash)) ? "confirmed" : "denied";
  }
  if (proof.idToken && factors.firebaseUid) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(proof.idToken);
      const age = Date.now() / 1000 - decoded.auth_time;
      return decoded.uid === factors.firebaseUid && age >= 0 && age <= REAUTH_WINDOW_SECONDS ? "confirmed" : "denied";
    } catch {
      return "denied";
    }
  }
  return "denied";
}

export async function confirmShopkeeperIdentity(shopkeeperId: string, password: string): Promise<Reauthentication> {
  const shopkeeper = await prisma.shopkeeper.findUnique({ where: { id: shopkeeperId }, select: { passwordHash: true } });
  if (!shopkeeper) return "not-found";
  return (await verifyPassword(password, shopkeeper.passwordHash)) ? "confirmed" : "denied";
}
