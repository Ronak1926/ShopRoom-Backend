import { PrismaClient } from "../generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { logger } from "../lib/logger.js";
import { dbPoolConfig } from "../config/env.js";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __dbConnected: boolean | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({ connectionString, ...dbPoolConfig() });

export const prisma = global.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export async function connectDatabase() {
  if (global.__dbConnected) {
    return;
  }

  await prisma.$connect();
  global.__dbConnected = true;
  logger.info("Database connected");
}
