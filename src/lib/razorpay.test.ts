import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createRazorpayOrder,
  fetchOrderSummary,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpay.js";

const KEY_SECRET = "test-key-secret";
const WEBHOOK_SECRET = "test-webhook-secret";
const hmac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

const ENV_KEYS = ["LOG_LEVEL", "NODE_ENV", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // The "credentials not configured" warnings are expected here.
  process.env.LOG_LEVEL = "silent";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("verifyPaymentSignature", () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });

  it("accepts the HMAC of order|payment", () => {
    assert.equal(verifyPaymentSignature("order_1", "pay_1", hmac(KEY_SECRET, "order_1|pay_1")), true);
  });

  it("rejects a signature for a different order or payment", () => {
    const signature = hmac(KEY_SECRET, "order_1|pay_1");
    assert.equal(verifyPaymentSignature("order_2", "pay_1", signature), false);
    assert.equal(verifyPaymentSignature("order_1", "pay_2", signature), false);
  });

  it("rejects a signature made with another secret", () => {
    assert.equal(verifyPaymentSignature("order_1", "pay_1", hmac("other", "order_1|pay_1")), false);
  });

  it("rejects malformed signatures without throwing", () => {
    for (const bad of ["", "zz", "not-hex-at-all!!", "ab".repeat(31), "ab".repeat(33), " "]) {
      assert.equal(verifyPaymentSignature("order_1", "pay_1", bad), false, JSON.stringify(bad));
    }
  });

  it("is not fooled by swapping the two ids", () => {
    assert.equal(verifyPaymentSignature("pay_1", "order_1", hmac(KEY_SECRET, "order_1|pay_1")), false);
  });

  it("skips verification only outside production when no secret is configured", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    assert.equal(verifyPaymentSignature("o", "p", "anything"), true);
    process.env.NODE_ENV = "production";
    assert.equal(verifyPaymentSignature("o", "p", "anything"), false);
  });
});

describe("verifyWebhookSignature", () => {
  const body = '{"event":"payment.captured"}';

  it("accepts the HMAC of the raw body", () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    assert.equal(verifyWebhookSignature(body, hmac(WEBHOOK_SECRET, body)), true);
  });

  it("rejects a changed body, another secret and malformed signatures", () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const signature = hmac(WEBHOOK_SECRET, body);
    assert.equal(verifyWebhookSignature(body + " ", signature), false);
    assert.equal(verifyWebhookSignature(body, hmac("other", body)), false);
    for (const bad of ["", "short", signature.slice(1), signature + "0"]) {
      assert.equal(verifyWebhookSignature(body, bad), false, JSON.stringify(bad));
    }
  });

  it("rejects everything when no webhook secret is configured, in every environment", () => {
    assert.equal(verifyWebhookSignature(body, hmac("", body)), false);
    process.env.NODE_ENV = "production";
    assert.equal(verifyWebhookSignature(body, hmac("", body)), false);
  });
});

describe("orders without credentials", () => {
  it("creates a recognisable mock order outside production", async () => {
    const order = await createRazorpayOrder(39900, "sk_abc");
    assert.equal(order.mock, true);
    assert.equal(order.amount, 39900);
    assert.equal(order.currency, "INR");
    assert.match(order.orderId, /^order_mock_sk_abc_\d+$/);
  });

  it("reads the receipt back from a mock order but reports no charged amount", async () => {
    const { orderId } = await createRazorpayOrder(39900, "sk_abc");
    assert.deepEqual(await fetchOrderSummary(orderId), { amount: null, receipt: "sk_abc" });
    assert.deepEqual(await fetchOrderSummary("order_real_looking"), { amount: null, receipt: null });
  });

  it("refuses to create or look up orders in production", async () => {
    process.env.NODE_ENV = "production";
    await assert.rejects(createRazorpayOrder(39900, "sk_abc"), /not configured/);
    await assert.rejects(fetchOrderSummary("order_x"), /not configured/);
  });
});
