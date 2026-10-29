/**
 * config/env.ts — Runtime configuration that has security consequences.
 *
 * Development may run without third-party credentials (the integrations fall
 * back to mocks), but a production process must never do that: a missing
 * payment or OTP secret would silently turn verification into a no-op. The
 * server therefore refuses to start in production until every secret below is
 * present, and the integrations also fail closed on their own.
 */

type Env = Record<string, string | undefined>;

const MIN_JWT_SECRET_LENGTH = 32;

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "CORS_ORIGINS",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

export function isProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** Names of the settings that are missing or weak. Never includes values. */
export function productionConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const jwtSecret = env.JWT_SECRET ?? "";
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET (must be at least ${MIN_JWT_SECRET_LENGTH} characters)`);
  }
  for (const name of REQUIRED_IN_PRODUCTION) {
    if (!env[name]?.trim()) problems.push(name);
  }
  return problems;
}

export function assertProductionConfig(env: Env = process.env): void {
  if (!isProduction(env)) return;
  const problems = productionConfigProblems(env);
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production. Fix these settings: ${problems.join(", ")}`);
  }
}

/**
 * Origins allowed to call the API from a browser. `null` means "any origin"
 * and is only returned outside production when CORS_ORIGINS is unset, so local
 * development (including testing from a phone on the LAN) keeps working.
 */
export function allowedOrigins(env: Env = process.env): string[] | null {
  const configured = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return isProduction(env) ? [] : null;
}

/** Express `trust proxy` setting; only trust forwarded headers when told to. */
export function trustProxySetting(env: Env = process.env): number | false {
  const hops = Number(env.TRUST_PROXY_HOPS ?? 0);
  return Number.isInteger(hops) && hops > 0 && hops <= 5 ? hops : false;
}
