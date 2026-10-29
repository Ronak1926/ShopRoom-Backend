import express from "express";
import cors from "cors";

import { customersRouter } from "./routes/customers.js";
import { otpRouter } from "./routes/otp.js";
import { shopkeeperRouter } from "./routes/shopkeeper.js";
import { shopRouter } from "./routes/shop.js";
import { roomsRouter } from "./routes/rooms.js";
import { messagesRouter } from "./routes/messages.js";
import { notificationsRouter } from "./routes/notifications.js";
import { notificationDeliveryRouter } from "./routes/notificationDelivery.js";

export const app = express();

app.use(cors());

// ── Razorpay webhook: must receive the raw body for HMAC signature verification ─
// Mount BEFORE express.json() so the raw bytes are preserved.
app.use(
  "/api/shopkeeper/payment/webhook",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    // Attach rawBody as a string so the route handler can re-use it
    (req as any).rawBody = req.body.toString("utf-8");
    next();
  },
);

app.use(express.json({ limit: "10mb" })); // allow base64 logo uploads

app.use("/api/customers", customersRouter);
app.use("/api/otp", otpRouter);
app.use("/api/shopkeeper", shopkeeperRouter);
app.use("/api/shop", shopRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/rooms", messagesRouter);
// notificationDeliveryRouter must be mounted BEFORE notificationsRouter: both
// share the /api/notifications prefix, and notificationsRouter applies
// requireShopkeeperAuth unconditionally via .use() — that middleware runs for
// every request reaching this prefix regardless of whether a route inside it
// matches, so it would 401 customer requests before they ever reached the
// other router if registered first.
app.use("/api/notifications", notificationDeliveryRouter);
app.use("/api/notifications", notificationsRouter);
