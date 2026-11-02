// Creates (if missing) and migrates the integration-test database named by
// TEST_DATABASE_URL in .env.test. Safe to run repeatedly.
//
//   cp .env.test.example .env.test   # then edit the URL
//   pnpm test:db:setup
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!process.env.TEST_DATABASE_URL && existsSync(".env.test")) {
  process.loadEnvFile(".env.test");
}

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set (put it in .env.test).");
  process.exit(1);
}
// The suite truncates tables; never let it point at a real database.
if (!/test/i.test(new URL(url).pathname)) {
  console.error("Refusing to continue: the test database name must contain 'test'.");
  process.exit(1);
}

// `prisma migrate deploy` creates a missing database and applies every migration.
const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);
