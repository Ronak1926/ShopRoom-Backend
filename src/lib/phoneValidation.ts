/**
 * phoneValidation.ts
 *
 * Validates an Indian mobile number using the Twilio Lookup API v2
 * with the "line_type_intelligence" field.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. We build an E.164 number from the raw 10-digit input: "+91XXXXXXXXXX"
 * 2. We call client.lookups.v2.phoneNumbers(e164).fetch({ fields: "line_type_intelligence" })
 *    Twilio's response includes:
 *      • valid               – boolean: whether the number exists in any global numbering plan
 *      • line_type_intelligence.type  – what kind of line it is:
 *            "mobile"        → real SIM-based mobile (Jio, Airtel, Vi, BSNL …) ✅
 *            "landline"      → fixed-line telephone ❌
 *            "voip"          → fixed VoIP (e.g. business SIP trunks)            ❌
 *            "nonFixedVoIP"  → app-based virtual number (Google Voice, Skype,
 *                              TextNow, Hushed, Burner …)                        ❌
 *            "tollFree"      → 1800 / 0800 numbers                              ❌
 *            "premiumRate"   → pay-per-call numbers                             ❌
 *      • line_type_intelligence.carrier_name  – e.g. "Reliance Jio Infocomm"
 *      • line_type_intelligence.error_code    – non-null when sub-lookup failed
 *
 * 3. We reject everything that is not "mobile".
 *    VoIP and nonFixedVoIP get a specific message; every other non-mobile type
 *    gets the generic "Only mobile numbers are accepted" message.
 *
 * FALLBACK (Twilio not configured)
 * ─────────────────────────────────
 * When TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set the function logs a
 * warning and returns `{ valid: true }` so local development keeps working
 * without Twilio credentials.
 *
 * NOTE ON BILLING
 * ────────────────
 * Line Type Intelligence is a paid Twilio add-on (~$0.005 per lookup).
 * Enable it at: console.twilio.com → Verify → Phone Intelligence → Line Type Intelligence
 * Each phone OTP send will consume one lookup unit.
 */

import twilio from "twilio";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhoneValidationResult {
  valid: boolean;
  /** Human-readable error message when valid === false */
  error?: string;
  /** Twilio line type string, e.g. "mobile", "voip", "nonFixedVoIP" */
  lineType?: string;
  /** Carrier name, e.g. "Reliance Jio Infocomm" */
  carrier?: string;
}

// The Twilio SDK types lineTypeIntelligence as Record<string,unknown>
// so we define the shape we actually use here.
/*
interface LineTypeIntelligence {
  type: string | null;
  carrier_name: string | null;
  mobile_country_code: string | null;
  mobile_network_code: string | null;
  error_code: number | null;
}
*/

// Line types that Twilio classifies as virtual / non-physical SIM lines.
// These are the OTP-farming vectors we want to block.
// const VOIP_LINE_TYPES = new Set(["voip", "non_fixed_voip", "nonfixedvoip"]);

// ─── Main validation function ─────────────────────────────────────────────────

/**
 * Validates a raw 10-digit Indian phone number via Twilio Lookup API.
 *
 * @param phoneNumber  Raw 10-digit number WITHOUT country prefix, e.g. "9876543210"
 *
 * NOTE: Twilio Lookup API (Line Type Intelligence) is a paid add-on (~$0.005/lookup).
 * The lookup block below is commented out until the add-on is enabled.
 * To re-enable: uncomment everything inside the "TWILIO LOOKUP BLOCK" comment markers
 * and activate Line Type Intelligence at:
 *   console.twilio.com → Verify → Phone Intelligence → Line Type Intelligence
 */
export async function validatePhoneNumber(
  phoneNumber: string,
): Promise<PhoneValidationResult> {
  // ── TWILIO LOOKUP BLOCK — uncomment when Line Type Intelligence is enabled ──
  //
  // const sid = process.env.TWILIO_ACCOUNT_SID;
  // const authToken = process.env.TWILIO_AUTH_TOKEN;
  //
  // if (!sid || !authToken) {
  //   console.warn(
  //     `\n⚠️  [Phone Validation] Twilio not configured — skipping Lookup API.\n` +
  //       `   Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to enable validation.\n`,
  //   );
  //   return { valid: true };
  // }
  //
  // const e164 = `+91${phoneNumber}`; // → "+919876543210"
  // const client = twilio(sid, authToken);
  //
  // try {
  //   // "fields=line_type_intelligence" asks Twilio to include the paid add-on data.
  //   const result = await client.lookups.v2
  //     .phoneNumbers(e164)
  //     .fetch({ fields: "line_type_intelligence" });
  //
  //   // result.valid = false → number doesn't exist in any numbering plan
  //   if (!result.valid) {
  //     return { valid: false, error: "Invalid phone number" };
  //   }
  //
  //   const lti = result.lineTypeIntelligence as LineTypeIntelligence | null;
  //
  //   if (!lti || lti.error_code !== null) {
  //     // Sub-lookup failed (Twilio outage) — fail open so users aren't blocked
  //     console.warn(`[Phone Validation] Line type sub-lookup failed for ${e164}:`, lti?.error_code);
  //     return { valid: true };
  //   }
  //
  //   const lineType = (lti.type ?? "").toLowerCase();
  //
  //   // Reject VoIP / virtual numbers (Google Voice, TextNow, Hushed, Burner, etc.)
  //   if (VOIP_LINE_TYPES.has(lineType) || lineType === "nonfixedvoip") {
  //     return { valid: false, error: "Virtual/VoIP numbers are not allowed", lineType };
  //   }
  //
  //   // Reject everything that is not a real mobile SIM line
  //   if (lineType !== "mobile") {
  //     return { valid: false, error: "Only mobile numbers are accepted", lineType };
  //   }
  //
  //   return { valid: true, lineType, carrier: lti.carrier_name ?? undefined };
  //
  // } catch (err: unknown) {
  //   const e = err as { code?: number; message?: string };
  //   if (e.code === 20404) {
  //     return { valid: false, error: "Invalid phone number" };
  //   }
  //   console.error(`[Phone Validation] Unexpected Twilio error for ${phoneNumber}:`, e.message);
  //   return { valid: true }; // fail open on unexpected errors
  // }
  //
  // ── END TWILIO LOOKUP BLOCK ──────────────────────────────────────────────────

  // Lookup is disabled — all numbers that pass the regex check are accepted.
  void twilio; // suppress unused-import warning while block is commented out
  return { valid: true };
}
