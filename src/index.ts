import "dotenv/config";

import { createServer } from "http";
import express from "express";
import cors from "cors";

import { customersRouter } from "./routes/customers.js";
import { otpRouter } from "./routes/otp.js";
import { shopkeeperRouter } from "./routes/shopkeeper.js";
import { shopRouter } from "./routes/shop.js";
import { roomsRouter } from "./routes/rooms.js";
import { messagesRouter } from "./routes/messages.js";
import { notificationsRouter } from "./routes/notifications.js";
import { connectDatabase } from "./database/prisma.js";
import { cleanupExpiredDrafts } from "./services/shopkeeper.service.js";
import { createSocketServer } from "./realtime/socket.js";

const app = express();

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
app.use("/api/notifications", notificationsRouter);

// Socket.IO needs the raw http.Server, so it's created explicitly instead of
// via the implicit server app.listen() would otherwise create.
const httpServer = createServer(app);
createSocketServer(httpServer);

connectDatabase().then(() => {
  // Clean up expired shopkeeper drafts on startup
  cleanupExpiredDrafts().catch(console.error);

  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
});
