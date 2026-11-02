import "dotenv/config";

import { createServer } from "http";

import { assertProductionConfig } from "./config/env.js";
import { app } from "./app.js";
import { connectDatabase } from "./database/prisma.js";
import { cleanupExpiredDrafts } from "./services/shopkeeper.service.js";
import { createSocketServer } from "./realtime/socket.js";
import { startNotificationScheduler } from "./services/notificationScheduler.service.js";
import { startDataRetention } from "./services/dataRetention.service.js";
import { logger } from "./lib/logger.js";

// Refuse to run in production with missing or weak secrets (see config/env.ts).
assertProductionConfig();

// An uncaught exception leaves the process in an unknown state: record it, give the
// log and error report a moment to flush, then exit so the supervisor restarts a clean one.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", err);
  setTimeout(() => process.exit(1), 1000).unref();
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason instanceof Error ? reason : new Error(String(reason)));
});

// Socket.IO needs the raw http.Server, so it's created explicitly instead of
// via the implicit server app.listen() would otherwise create.
const httpServer = createServer(app);
createSocketServer(httpServer);

connectDatabase().then(() => {
  // Clean up expired shopkeeper drafts on startup
  cleanupExpiredDrafts().catch((err) => logger.error("Draft cleanup failed", err));

  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    logger.info("Server started", { port: Number(port) });
  });

  startNotificationScheduler();
  startDataRetention();
});
