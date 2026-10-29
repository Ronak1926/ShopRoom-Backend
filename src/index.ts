import "dotenv/config";

import { createServer } from "http";

import { app } from "./app.js";
import { connectDatabase } from "./database/prisma.js";
import { cleanupExpiredDrafts } from "./services/shopkeeper.service.js";
import { createSocketServer } from "./realtime/socket.js";
import { startNotificationScheduler } from "./services/notificationScheduler.service.js";

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

  startNotificationScheduler();
});
