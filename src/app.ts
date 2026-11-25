import express, { type Request, type Router } from "express";
import cors from "cors";

import { allowedOrigins, trustProxySetting } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { globalLimiter } from "./middleware/rateLimiters.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { opsRouter } from "./routes/ops.js";
import { clientErrorsRouter } from "./routes/clientErrors.js";
import { publicRouter } from "./routes/public.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { compressJson } from "./middleware/compress.js";
import { customersRouter } from "./routes/customers.js";
import { otpRouter } from "./routes/otp.js";
import { shopkeeperRouter } from "./routes/shopkeeper.js";
import { shopRouter } from "./routes/shop.js";
import { roomsRouter } from "./routes/rooms.js";
import { messagesRouter } from "./routes/messages.js";
import { notificationsRouter } from "./routes/notifications.js";
import { notificationDeliveryRouter } from "./routes/notificationDelivery.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", trustProxySetting());

app.use(securityHeaders);
app.use(compressJson);
app.use(requestLogger);

// Monitoring endpoints sit before CORS and the global limiter so uptime checks
// and metric scrapes are never throttled or blocked by browser rules.
app.use(opsRouter);

// Browser callers must be on the allow-list (CORS_ORIGINS). Requests with no
// Origin header (server-to-server, mobile apps, curl) aren't subject to CORS.
app.use(
  cors({
    origin(origin, callback) {
      const allowed = allowedOrigins();
      callback(null, !origin || allowed === null || allowed.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "Cache-Control", "If-None-Match", "X-Session-Mode"],
    // The session cookie is sent on cross-origin calls from an allowed origin (the web app on another port or subdomain).
    credentials: true,
    // Without this the page cannot read the file name of a download ("Download my data") from another origin.
    exposedHeaders: ["Content-Disposition"],
    maxAge: 600,
  }),
);

app.use(globalLimiter);

// ── Razorpay webhook: must receive the raw body for HMAC signature verification ─
// Mount BEFORE express.json() so the raw bytes are preserved.
app.use(
  "/api/shopkeeper/payment/webhook",
  express.raw({ type: "application/json", limit: "100kb" }),
  (req: Request & { rawBody?: string }, _res, next) => {
    // Attach rawBody as a string so the route handler can re-use it
    req.rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : undefined;
    next();
  },
);

// Only routes that accept base64 images get a large body budget. A parser that
// has already read the body makes the later ones skip it.
const imageBody = express.json({ limit: "13mb" });
app.use("/api/shopkeeper/upload-logo", imageBody);
app.use("/api/shop/room/images", imageBody);
app.use("/api/notifications/assets", imageBody);
app.use("/api/notifications", express.json({ limit: "1mb" }));

app.use(express.json({ limit: "100kb" }));

// Exported so tests can walk every route and check its authentication.
//
// notificationDeliveryRouter must be mounted BEFORE notificationsRouter: both
// share the /api/notifications prefix, and notificationsRouter applies
// requireShopkeeperAuth unconditionally via .use() — that middleware runs for
// every request reaching this prefix regardless of whether a route inside it
// matches, so it would 401 customer requests before they ever reached the
// other router if registered first.
export const routeMounts: { prefix: string; router: Router }[] = [
  { prefix: "/api/customers", router: customersRouter },
  { prefix: "/api/otp", router: otpRouter },
  { prefix: "/api/shopkeeper", router: shopkeeperRouter },
  { prefix: "/api/shop", router: shopRouter },
  { prefix: "/api/rooms", router: roomsRouter },
  { prefix: "/api/rooms", router: messagesRouter },
  { prefix: "/api/notifications", router: notificationDeliveryRouter },
  { prefix: "/api/notifications", router: notificationsRouter },
  { prefix: "/api/client-errors", router: clientErrorsRouter },
  { prefix: "/api/public", router: publicRouter },
];
/** Every router, including the monitoring one mounted earlier; used by tests to inventory routes. */
export const allRouteMounts = [{ prefix: "", router: opsRouter }, ...routeMounts];
for (const { prefix, router } of routeMounts) app.use(prefix, router);

app.use(notFoundHandler);
app.use(errorHandler);
