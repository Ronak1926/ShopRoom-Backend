import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  PaymentProviderError,
  createRazorpayOrder,
  isMockOrderId,
  refundPayment,
  setRazorpayClientForTests,
  verifyPaymentSignature,
  verifyWebhookSignature,
  type RazorpayApi,
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

describe("orders and refunds without credentials", () => {
  it("creates a recognisable mock order outside production", async () => {
    const order = await createRazorpayOrder({ amount: 39900, receipt: "po_abc" });
    assert.equal(order.mock, true);
    assert.equal(order.amount, 39900);
    assert.equal(order.currency, "INR");
    assert.equal(order.orderId, "order_mock_po_abc");
    assert.equal(isMockOrderId(order.orderId), true);
    assert.equal(isMockOrderId("order_Abc123"), false);
  });

  it("pretends to refund outside production, and refuses to in production", async () => {
    assert.deepEqual(await refundPayment("pay_1", 39900), { id: "rfnd_mock_pay_1" });
    process.env.NODE_ENV = "production";
    await assert.rejects(refundPayment("pay_1", 39900), /not configured/);
  });

  it("refuses to create orders in production", async () => {
    process.env.NODE_ENV = "production";
    await assert.rejects(createRazorpayOrder({ amount: 39900, receipt: "po_abc" }), /not configured/);
  });
});

describe("against Razorpay", () => {
  const sdkError = (statusCode: number, description: string) => ({ statusCode, error: { code: "BAD_REQUEST_ERROR", description } });
  const calls: { orders: unknown[]; refunds: unknown[] } = { orders: [], refunds: [] };
  let create: RazorpayApi["orders"]["create"];
  let refund: RazorpayApi["payments"]["refund"];

  beforeEach(() => {
    calls.orders = [];
    calls.refunds = [];
    create = async (body) => {
      calls.orders.push(body);
      return { id: "order_Real1", amount: String(body.amount), currency: body.currency };
    };
    refund = async (paymentId, body) => {
      calls.refunds.push({ paymentId, ...body });
      return { id: "rfnd_Real1" };
    };
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc123XYZ789";
    setRazorpayClientForTests({ orders: { create: (body) => create(body) }, payments: { refund: (id, body) => refund(id, body) } });
  });
  afterEach(() => {
    setRazorpayClientForTests(null);
    mock.timers.reset();
  });

  it("creates an auto-captured INR order and returns the public key, never the secret", async () => {
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    const order = await createRazorpayOrder({ amount: 59900, receipt: "po_xyz", notes: { purpose: "RENEWAL" } });
    assert.deepEqual(order, { orderId: "order_Real1", amount: 59900, currency: "INR", keyId: "rzp_test_abc123XYZ789" });
    assert.deepEqual(calls.orders, [{ amount: 59900, currency: "INR", receipt: "po_xyz", payment_capture: 1, notes: { purpose: "RENEWAL" } }]);
    assert.ok(!JSON.stringify(order).includes(KEY_SECRET));
  });

  it("turns a Razorpay failure into a safe message that says whether retrying can help", async () => {
    create = async () => { throw sdkError(400, "The api key provided is invalid: rzp_test_SECRETISH"); };
    const rejected = await createRazorpayOrder({ amount: 1, receipt: "po_1" }).catch((e: unknown) => e);
    assert.ok(rejected instanceof PaymentProviderError);
    assert.equal(rejected.retryable, false, "a 4xx will not fix itself");
    assert.ok(!rejected.message.includes("rzp_"), "provider text is never shown to the buyer");

    create = async () => { throw sdkError(502, "Bad gateway"); };
    const flaky = await createRazorpayOrder({ amount: 1, receipt: "po_1" }).catch((e: unknown) => e);
    assert.ok(flaky instanceof PaymentProviderError);
    assert.equal(flaky.retryable, true);

    create = async () => { throw new Error("socket hang up"); };
    const dropped = await createRazorpayOrder({ amount: 1, receipt: "po_1" }).catch((e: unknown) => e);
    assert.ok(dropped instanceof PaymentProviderError && dropped.retryable);
  });

  it("gives up on a stalled connection instead of holding the request open", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    create = () => new Promise(() => undefined);
    const pending = createRazorpayOrder({ amount: 1, receipt: "po_1" }).catch((e: unknown) => e);
    mock.timers.tick(10_000);
    const rejected = await pending;
    assert.ok(rejected instanceof PaymentProviderError && rejected.retryable);
  });

  it("refunds the whole payment", async () => {
    assert.deepEqual(await refundPayment("pay_Real1", 89900, { order: "po_1", reason: "duplicate" }), { id: "rfnd_Real1" });
    assert.deepEqual(calls.refunds, [{ paymentId: "pay_Real1", amount: 89900, speed: "normal", notes: { order: "po_1", reason: "duplicate" } }]);
  });

  it("counts an already-refunded payment as done, so a retry can never double-refund", async () => {
    for (const description of ["The payment has been fully refunded already", "The refund amount provided is greater than amount captured"]) {
      refund = async () => { throw sdkError(400, description); };
      assert.deepEqual(await refundPayment("pay_Real1", 89900), { id: null }, description);
    }
  });

  it("reports any other refund failure", async () => {
    refund = async () => { throw sdkError(500, "Server error"); };
    const rejected = await refundPayment("pay_Real1", 89900).catch((e: unknown) => e);
    assert.ok(rejected instanceof PaymentProviderError && rejected.retryable);
  });
});
