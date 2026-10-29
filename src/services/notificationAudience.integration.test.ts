import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  MUMBAI,
  connectTestEnvironment,
  createCustomer,
  createShop,
  integrationConfigured,
  resetDatabase,
  type TestPrisma,
} from "../test/integration.js";
import { haversineKm } from "../utils/geo.js";

const enabled = integrationConfigured();

// ~2 km, ~6.5 km, ~19 km and ~120 km from the Mumbai shop.
const NEAR = { latitude: 19.09, longitude: 72.89 };
const MID = { latitude: 19.13, longitude: 72.9 };
const FAR = { latitude: 19.25, longitude: 72.9 };
const PUNE = { latitude: 18.5204, longitude: 73.8567 };

describe("resolveAudienceDevices", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let resolve: typeof import("./notificationAudience.service.js").resolveAudienceDevices;
  let roomId: string;

  const tokensFor = async (spec: Parameters<typeof resolve>[0]) =>
    (await resolve(spec)).map((d) => d.fcmToken).sort();

  before(async () => {
    ({ prisma } = await connectTestEnvironment());
    ({ resolveAudienceDevices: resolve } = await import("./notificationAudience.service.js"));
  });

  after(async () => {
    await prisma.$disconnect();
  });

  async function seed() {
    await resetDatabase(prisma);
    ({ roomId } = await createShop(prisma));
    return {
      memberAnywhere: await createCustomer(prisma, { member: { roomId } }), // no location at all
      memberNear: await createCustomer(prisma, { member: { roomId }, location: NEAR }),
      memberFar: await createCustomer(prisma, { member: { roomId }, location: PUNE }),
      mutedNear: await createCustomer(prisma, {
        member: { roomId, notificationsEnabled: false },
        location: NEAR,
      }),
      mutedAnywhere: await createCustomer(prisma, {
        member: { roomId, notificationsEnabled: false },
      }),
      strangerNear: await createCustomer(prisma, { location: MID }),
      strangerFarLimit: await createCustomer(prisma, { location: FAR }),
      strangerStale: await createCustomer(prisma, { location: NEAR, locationAgeHours: 49 }),
      strangerOptedOut: await createCustomer(prisma, { location: NEAR, allowLocation: false }),
      strangerElsewhere: await createCustomer(prisma, { location: PUNE }),
      twoDevices: await createCustomer(prisma, { member: { roomId }, devices: 2 }),
    };
  }

  const sorted = (...tokenLists: string[][]) => tokenLists.flat().sort();

  it("ROOM_MEMBERS targets every member who has notifications on, wherever they are", async () => {
    const c = await seed();
    assert.deepEqual(
      await tokensFor({ roomId, kind: "ROOM_MEMBERS" }),
      sorted(c.memberAnywhere.tokens, c.memberNear.tokens, c.memberFar.tokens, c.twoDevices.tokens),
    );
  });

  it("ROOM_MEMBERS never includes a member who muted the room", async () => {
    const c = await seed();
    const tokens = await tokensFor({ roomId, kind: "ROOM_MEMBERS" });
    assert.ok(!tokens.includes(c.mutedNear.tokens[0]));
    assert.ok(!tokens.includes(c.mutedAnywhere.tokens[0]));
  });

  it("ROOM_MEMBERS returns one row per device, so a two-device customer is reached on both", async () => {
    const c = await seed();
    const devices = await resolve({ roomId, kind: "ROOM_MEMBERS" });
    const mine = devices.filter((d) => d.customerId === c.twoDevices.customerId);
    assert.equal(mine.length, 2);
  });

  it("MEMBERS_NEARBY targets only members inside the radius", async () => {
    const c = await seed();
    assert.deepEqual(
      await tokensFor({ roomId, kind: "MEMBERS_NEARBY", radiusKm: 10, center: MUMBAI }),
      sorted(c.memberNear.tokens),
    );
  });

  it("NEARBY adds non-members inside the radius and still honours mutes, consent and freshness", async () => {
    const c = await seed();
    const tokens = await tokensFor({ roomId, kind: "NEARBY", radiusKm: 10, center: MUMBAI });
    assert.deepEqual(tokens, sorted(c.memberNear.tokens, c.strangerNear.tokens));
    assert.ok(!tokens.includes(c.mutedNear.tokens[0]), "muted member inside the radius");
    assert.ok(!tokens.includes(c.strangerStale.tokens[0]), "stale location");
    assert.ok(!tokens.includes(c.strangerOptedOut.tokens[0]), "location access off");
    assert.ok(!tokens.includes(c.strangerElsewhere.tokens[0]), "outside the radius");
  });

  it("treats a location reported just inside the freshness window as live", async () => {
    // 1h inside / 1h outside the window: far tighter than any time-zone offset,
    // so a Date-parameter timezone bug in the query would flip one of these.
    await resetDatabase(prisma);
    ({ roomId } = await createShop(prisma));
    const inside = await createCustomer(prisma, { location: NEAR, locationAgeHours: 47 });
    const outside = await createCustomer(prisma, { location: NEAR, locationAgeHours: 49 });
    const tokens = await tokensFor({ roomId, kind: "NEARBY", radiusKm: 10, center: MUMBAI });
    assert.ok(tokens.includes(inside.tokens[0]));
    assert.ok(!tokens.includes(outside.tokens[0]));
  });

  it("a larger radius reaches further out", async () => {
    const c = await seed();
    const tokens = await tokensFor({ roomId, kind: "NEARBY", radiusKm: 25, center: MUMBAI });
    assert.ok(tokens.includes(c.strangerFarLimit.tokens[0]));
    assert.ok(!tokens.includes(c.strangerElsewhere.tokens[0]));
  });

  it("MEMBERS_AND_NEARBY is the union, counting overlap once", async () => {
    const c = await seed();
    const devices = await resolve({
      roomId,
      kind: "MEMBERS_AND_NEARBY",
      radiusKm: 10,
      center: MUMBAI,
    });
    const tokens = devices.map((d) => d.fcmToken).sort();
    assert.deepEqual(
      tokens,
      sorted(
        c.memberAnywhere.tokens,
        c.memberNear.tokens,
        c.memberFar.tokens,
        c.twoDevices.tokens,
        c.strangerNear.tokens,
      ),
    );
    assert.equal(new Set(tokens).size, tokens.length, "no device listed twice");
  });

  it("membersJoinedBefore leaves out members who joined later", async () => {
    await resetDatabase(prisma);
    ({ roomId } = await createShop(prisma));
    const cutoff = new Date();
    const early = await createCustomer(prisma, {
      member: { roomId, joinedAt: new Date(cutoff.getTime() - 3_600_000) },
    });
    await createCustomer(prisma, {
      member: { roomId, joinedAt: new Date(cutoff.getTime() + 3_600_000) },
    });
    assert.deepEqual(
      await tokensFor({ roomId, kind: "ROOM_MEMBERS", membersJoinedBefore: cutoff }),
      sorted(early.tokens),
    );
  });

  it("rejects a radius audience that has no centre", async () => {
    await assert.rejects(() => resolve({ roomId, kind: "NEARBY", radiusKm: 5 }));
  });

  it("agrees with the JavaScript Haversine on a grid around the shop", async () => {
    await resetDatabase(prisma);
    ({ roomId } = await createShop(prisma));
    const radiusKm = 10;
    const points: { latitude: number; longitude: number; token: string }[] = [];
    for (let dLat = -0.12; dLat <= 0.12; dLat += 0.03) {
      for (let dLng = -0.12; dLng <= 0.12; dLng += 0.03) {
        const location = {
          latitude: MUMBAI.latitude + dLat,
          longitude: MUMBAI.longitude + dLng,
        };
        const customer = await createCustomer(prisma, { location });
        points.push({ ...location, token: customer.tokens[0] });
      }
    }
    const inside = new Set(
      points
        .filter((p) => haversineKm(MUMBAI, p) <= radiusKm)
        .map((p) => p.token),
    );
    const resolved = new Set(
      await tokensFor({ roomId, kind: "NEARBY", radiusKm, center: MUMBAI }),
    );
    assert.ok(inside.size > 0 && inside.size < points.length, "grid straddles the radius");
    assert.deepEqual([...resolved].sort(), [...inside].sort());
  });
});
