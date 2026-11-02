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

export interface DbPoolConfig {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statement_timeout: number;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/**
 * Connection-pool limits for the Postgres driver. The library default waits
 * forever for a free connection, which turns pool exhaustion into hung requests;
 * an explicit acquire timeout makes it a fast, visible 500 instead.
 *
 * Size it so that (API instances x DB_POOL_MAX) stays under ~80% of Postgres's
 * max_connections; see docs/ops/PERFORMANCE.md. Out-of-range values fall back to defaults.
 */
export function dbPoolConfig(env: Env = process.env): DbPoolConfig {
  return {
    max: boundedInt(env.DB_POOL_MAX, 10, 1, 200),
    connectionTimeoutMillis: boundedInt(env.DB_POOL_ACQUIRE_TIMEOUT_MS, 5_000, 100, 60_000),
    idleTimeoutMillis: boundedInt(env.DB_POOL_IDLE_TIMEOUT_MS, 30_000, 1_000, 600_000),
    statement_timeout: boundedInt(env.DB_STATEMENT_TIMEOUT_MS, 30_000, 1_000, 600_000),
  };
}
