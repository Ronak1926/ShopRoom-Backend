import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import { PrismaClient } from "../src/generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ── Types ──────────────────────────────────────────────────────────────────────

interface RoomEntry {
  shopName: string;
  category: string;
  description: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  coverUrl: string;
  logoUrl: string;
}

interface LocationPool {
  city: string;
  state: string;
  lat: number;
  lng: number;
  weight: number;
  radiusKm: number;
}

interface CustomerPool {
  maleFirstNames: string[];
  femaleFirstNames: string[];
  surnames: string[];
  password: string;
  total: number;
  locationPools: LocationPool[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickLocationPool(pools: LocationPool[]): LocationPool {
  const r = Math.random();
  let cumulative = 0;
  for (const lp of pools) {
    cumulative += lp.weight;
    if (r < cumulative) return lp;
  }
  return pools[pools.length - 1];
}

function randomCoords(lp: LocationPool): { lat: number; lng: number } {
  // Random offset within the radius using a rectangular bounding box
  // 1° lat ≈ 111 km, 1° lng ≈ 90 km at these latitudes
  const latDelta = (Math.random() * 2 - 1) * (lp.radiusKm / 111);
  const lngDelta = (Math.random() * 2 - 1) * (lp.radiusKm / 90);
  return {
    lat: Math.round((lp.lat + latDelta) * 100000) / 100000,
    lng: Math.round((lp.lng + lngDelta) * 100000) / 100000,
  };
}

function genInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱  Seeding ShopRoom database...\n");

  // Hash passwords once (all shopkeepers share one password, all customers another)
  const [shopkeeperHash, customerHash] = await Promise.all([
    bcrypt.hash("Shopkeeper@123", 10),
    bcrypt.hash("Customer@123", 10),
  ]);

  // ── 1. Rooms ────────────────────────────────────────────────────────────────

  const roomEntries: RoomEntry[] = JSON.parse(
    readFileSync(resolve(__dirname, "seed-data/rooms.json"), "utf8"),
  );

  const roomIds: string[] = [];

  for (let i = 0; i < roomEntries.length; i++) {
    const r = roomEntries[i];

    // Derive a deterministic seed email for each shopkeeper
    const skEmail = `${r.shopName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "")}.${i + 1}@shoproom.seed`;

    // Shopkeeper
    const sk = await prisma.shopkeeper.upsert({
      where: { email: skEmail },
      update: {},
      create: {
        email: skEmail,
        passwordHash: shopkeeperHash,
        shopName: r.shopName,
        shopCategory: r.category,
        address: r.address,
        city: r.city,
        state: r.state,
        pincode: r.pincode,
        phoneNumber: r.phoneNumber,
        latitude: r.latitude,
        longitude: r.longitude,
        planType: "starter",
        planExpiresAt: new Date("2027-01-01T00:00:00Z"),
      },
    });

    // Shop
    const shop = await prisma.shop.upsert({
      where: { ownerId: sk.id },
      update: {},
      create: {
        ownerId: sk.id,
        shopName: r.shopName,
        category: r.category,
        description: r.description,
        logoUrl: r.logoUrl,
        address: r.address,
        city: r.city,
        state: r.state,
        pincode: r.pincode,
        phoneNumber: r.phoneNumber,
        latitude: r.latitude,
        longitude: r.longitude,
        coordinates: { type: "Point", coordinates: [r.longitude, r.latitude] },
      },
    });

    // Room (one per shop)
    let room = await prisma.room.findUnique({ where: { shopId: shop.id } });
    if (!room) {
      let code = genInviteCode();
      // Guarantee uniqueness across any existing rooms
      while (await prisma.room.findUnique({ where: { inviteCode: code } })) {
        code = genInviteCode();
      }
      room = await prisma.room.create({
        data: {
          shopId: shop.id,
          inviteCode: code,
          membersCount: 0,
          coverUrl: r.coverUrl,
        },
      });
    } else if (!room.coverUrl && r.coverUrl) {
      // Back-fill coverUrl on re-runs
      room = await prisma.room.update({
        where: { id: room.id },
        data: { coverUrl: r.coverUrl },
      });
    }

    roomIds.push(room.id);
    process.stdout.write(`\r  Rooms:     ${i + 1} / ${roomEntries.length}`);
  }

  console.log(`\n✅  ${roomEntries.length} rooms ready\n`);

  // ── 2. Customers ────────────────────────────────────────────────────────────

  const pool: CustomerPool = JSON.parse(
    readFileSync(resolve(__dirname, "seed-data/customers.json"), "utf8"),
  );
  const { maleFirstNames, femaleFirstNames, surnames, total, locationPools } =
    pool;

  const half = Math.ceil(total / 2);
  const customerRows: {
    fullName: string;
    email: string;
    passwordHash: string;
    emailVerified: boolean;
    allowLocationAccess: boolean;
    latitude: number;
    longitude: number;
  }[] = [];

  for (let i = 0; i < total; i++) {
    const isMale = i < half;
    const localI = isMale ? i : i - half;
    const firstNames = isMale ? maleFirstNames : femaleFirstNames;
    // Cycle first names; advance surname every firstNames.length entries
    const firstName = firstNames[localI % firstNames.length];
    const surname =
      surnames[Math.floor(localI / firstNames.length) % surnames.length];
    const email = `${firstName.toLowerCase()}.${surname.toLowerCase()}.${i + 1}@example.com`;
    const lp = pickLocationPool(locationPools);
    const coords = randomCoords(lp);

    customerRows.push({
      fullName: `${firstName} ${surname}`,
      email,
      passwordHash: customerHash,
      emailVerified: true,
      allowLocationAccess: true,
      latitude: coords.lat,
      longitude: coords.lng,
    });
  }

  // Batch-insert; skip any that already exist (idempotent re-runs)
  await prisma.customer.createMany({
    data: customerRows,
    skipDuplicates: true,
  });

  // Fetch all IDs so we can assign memberships
  const customers = await prisma.customer.findMany({
    where: { email: { in: customerRows.map((c) => c.email) } },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);

  console.log(`✅  ${customerIds.length} customers ready\n`);

  // ── 3. Memberships ──────────────────────────────────────────────────────────
  // Each customer joins 3–10 random rooms (average ~6.5 → ~3,250 memberships)

  const membershipSet = new Set<string>();
  const memberships: { roomId: string; customerId: string }[] = [];

  for (const customerId of customerIds) {
    const count = Math.floor(Math.random() * 8) + 3; // 3-10
    const shuffled = [...roomIds]
      .sort(() => Math.random() - 0.5)
      .slice(0, count);
    for (const roomId of shuffled) {
      const key = `${roomId}:${customerId}`;
      if (!membershipSet.has(key)) {
        membershipSet.add(key);
        memberships.push({ roomId, customerId });
      }
    }
  }

  const BATCH = 200;
  for (let i = 0; i < memberships.length; i += BATCH) {
    await prisma.membership.createMany({
      data: memberships.slice(i, i + BATCH),
      skipDuplicates: true,
    });
    process.stdout.write(
      `\r  Memberships: ${Math.min(i + BATCH, memberships.length)} / ${memberships.length}`,
    );
  }
  console.log();

  // Update membersCount on each room
  for (const roomId of roomIds) {
    const cnt = await prisma.membership.count({ where: { roomId } });
    await prisma.room.update({
      where: { id: roomId },
      data: { membersCount: cnt },
    });
  }

  console.log(`✅  ${memberships.length} memberships ready\n`);
  console.log("🎉  Seeding complete!");
  console.log("    Shopkeeper password : Shopkeeper@123");
  console.log("    Customer password   : Customer@123");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
