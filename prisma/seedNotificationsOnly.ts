/**
 * prisma/seedNotificationsOnly.ts — Refreshes just the notification catalog:
 * categories, animations and the v2 templates.
 *
 * The full seed (prisma/seed.ts) also creates demo shopkeepers, shops,
 * customers and memberships. Refreshing the template catalog should not mean
 * re-running any of that, so this entry point calls only seedNotifications.
 *
 * Idempotent: everything upserts by slug, so existing rows are updated in place
 * and nothing is deleted.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedNotifications } from "./notificationSeed.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  await seedNotifications(prisma);
  const active = await prisma.notificationTemplate.count({ where: { isActive: true } });
  console.log(`✅  ${active} active template(s) in the catalog`);
}

main()
  .catch((err) => {
    console.error("Notification seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
