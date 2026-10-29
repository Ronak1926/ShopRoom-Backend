import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
