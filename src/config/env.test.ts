import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dbPoolConfig,
  allowedOrigins,
  assertProductionConfig,
  isProduction,
  productionConfigProblems,
  trustProxySetting,
} from "./env.js";

const completeEnv = {
  NODE_ENV: "production",
  JWT_SECRET: "x".repeat(40),
  DATABASE_URL: "postgres://db",
  CORS_ORIGINS: "https://shoproom.example",
  FRONTEND_BASE_URL: "https://shoproom.example",
  RAZORPAY_KEY_ID: "id",
  RAZORPAY_KEY_SECRET: "secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec",
  TWILIO_ACCOUNT_SID: "sid",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_VERIFY_SERVICE_SID: "VA1",
  FIREBASE_PROJECT_ID: "p",
  FIREBASE_CLIENT_EMAIL: "e",
  FIREBASE_PRIVATE_KEY: "k",
};

describe("production configuration guard", () => {
  it("accepts a complete production environment", () => {
    assert.deepEqual(productionConfigProblems(completeEnv), []);
    assert.doesNotThrow(() => assertProductionConfig(completeEnv));
  });

  it("names every missing setting but never prints a value", () => {
    const env = { ...completeEnv, RAZORPAY_WEBHOOK_SECRET: "", TWILIO_AUTH_TOKEN: undefined };
    const problems = productionConfigProblems(env);
    assert.deepEqual(problems.sort(), ["RAZORPAY_WEBHOOK_SECRET", "TWILIO_AUTH_TOKEN"]);
    assert.throws(() => assertProductionConfig(env), (err: Error) => {
      assert.match(err.message, /RAZORPAY_WEBHOOK_SECRET/);
      assert.ok(!err.message.includes(completeEnv.JWT_SECRET));
      return true;
    });
  });

  it("rejects a short JWT secret", () => {
    const problems = productionConfigProblems({ ...completeEnv, JWT_SECRET: "short" });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /JWT_SECRET/);
  });

  it("does not block development", () => {
    assert.equal(isProduction({ NODE_ENV: "development" }), false);
    assert.doesNotThrow(() => assertProductionConfig({ NODE_ENV: "development" }));
    assert.doesNotThrow(() => assertProductionConfig({}));
  });
});

describe("allowedOrigins", () => {
  it("parses a comma separated list and trims trailing slashes", () => {
    assert.deepEqual(
      allowedOrigins({ CORS_ORIGINS: "https://a.example/, https://b.example" }),
      ["https://a.example", "https://b.example"],
    );
  });

  it("is open in development when unset", () => {
    assert.equal(allowedOrigins({}), null);
  });

  it("allows no browser origin in production when unset", () => {
    assert.deepEqual(allowedOrigins({ NODE_ENV: "production" }), []);
  });
});

describe("dbPoolConfig", () => {
  it("has bounded defaults, including an acquire timeout", () => {
    assert.deepEqual(dbPoolConfig({}), {
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
    });
  });

  it("reads overrides", () => {
    const config = dbPoolConfig({ DB_POOL_MAX: "25", DB_POOL_ACQUIRE_TIMEOUT_MS: "2000", DB_STATEMENT_TIMEOUT_MS: "60000" });
    assert.equal(config.max, 25);
    assert.equal(config.connectionTimeoutMillis, 2_000);
    assert.equal(config.statement_timeout, 60_000);
  });

  it("ignores nonsense and out-of-range values", () => {
    for (const bad of ["0", "-3", "abc", "", "1.5", "1000000"]) {
      assert.equal(dbPoolConfig({ DB_POOL_MAX: bad }).max, 10, bad);
    }
    assert.equal(dbPoolConfig({ DB_POOL_ACQUIRE_TIMEOUT_MS: "5" }).connectionTimeoutMillis, 5_000, "never disable the timeout");
  });
});

describe("trustProxySetting", () => {
  it("trusts nothing by default", () => {
    assert.equal(trustProxySetting({}), false);
  });

  it("trusts a bounded number of hops", () => {
    assert.equal(trustProxySetting({ TRUST_PROXY_HOPS: "1" }), 1);
    assert.equal(trustProxySetting({ TRUST_PROXY_HOPS: "99" }), false);
    assert.equal(trustProxySetting({ TRUST_PROXY_HOPS: "abc" }), false);
  });
});
