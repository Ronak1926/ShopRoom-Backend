import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MUMBAI, createCustomer, createDesign, createShop, integrationConfigured, resetDatabase, sampleDesign } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { haversineKm } from "../utils/geo.js";

const enabled = integrationConfigured();

/** Points at increasing distance from MUMBAI (roughly 0, 11, 22, 33 km north). */
const at = (km: number) => ({ latitude: MUMBAI.latitude + km / 111, longitude: MUMBAI.longitude });

describe("room discovery, map pins and member lists", { skip: !enabled }, () => {
  let t: TestApp;

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
  });

  async function shop(options: {
    name: string;
    category?: string;
    km?: number | null;
    members?: number;
  }) {
    const created = await createShop(t.prisma, {
      location: options.km === null ? null : at(options.km ?? 0),
    });
    await t.prisma.shop.update({
      where: { id: created.shopId },
      data: { shopName: options.name, category: options.category ?? "Fashion" },
    });
    await t.prisma.room.update({ where: { id: created.roomId }, data: { membersCount: options.members ?? 0 } });
    return created;
  }

  async function viewer(options: { located?: boolean } = {}) {
    const located = options.located ?? true;
    const customer = await createCustomer(t.prisma, { location: located ? MUMBAI : undefined, allowLocation: located });
    return { id: customer.customerId, token: t.customerToken(customer.customerId) };
  }

  const discover = (token: string, query = "") => t.call("GET", `/api/rooms/discover${query}`, { token });
  const names = (res: { json: { rooms: { shopName: string }[] } }) => res.json.rooms.map((r) => r.shopName);

  describe("GET /api/rooms/discover", () => {
    it("requires a customer session", async () => {
      assert.equal((await t.call("GET", "/api/rooms/discover")).status, 401);
    });

    it("ranks by distance, nearest first, with unknown positions last", async () => {
      await shop({ name: "Far", km: 33 });
      await shop({ name: "Nowhere", km: null });
      await shop({ name: "Near", km: 2 });
      await shop({ name: "Middle", km: 11 });
      const { token } = await viewer();

      const res = await discover(token);
      assert.equal(res.status, 200);
      assert.deepEqual(names(res), ["Near", "Middle", "Far", "Nowhere"]);

      const near = res.json.rooms[0];
      const expected = Math.round(haversineKm(MUMBAI, at(2)) * 10) / 10;
      assert.equal(near.distanceKm, expected);
      assert.equal(res.json.rooms[3].distanceKm, null);
    });

    it("reports no distances, and ranks stably, for a customer who has not shared a location", async () => {
      await shop({ name: "A", km: 1 });
      await shop({ name: "B", km: 20 });
      const { token } = await viewer({ located: false });
      const first = await discover(token);
      const again = await discover(token);
      assert.ok(first.json.rooms.every((r: { distanceKm: unknown }) => r.distanceKm === null));
      assert.deepEqual(names(first), names(again), "order does not flicker between requests");
    });

    it("ranks by member count when asked for popular", async () => {
      await shop({ name: "Quiet", members: 3, km: 1 });
      await shop({ name: "Busy", members: 90, km: 30 });
      await shop({ name: "Medium", members: 40, km: 10 });
      const { token } = await viewer();

      const res = await discover(token, "?sort=popular");
      assert.deepEqual(names(res), ["Busy", "Medium", "Quiet"]);
      assert.equal(res.json.rooms[0].distanceKm, Math.round(haversineKm(MUMBAI, at(30)) * 10) / 10);
    });

    it("filters by category without regard to case, and keeps trending and categories global", async () => {
      await shop({ name: "Tee", category: "Clothing", members: 5, km: 1 });
      await shop({ name: "Loaf", category: "Bakery", members: 50, km: 2 });
      await shop({ name: "Jeans", category: "Clothing", members: 7, km: 3 });
      const { token } = await viewer();

      const filtered = await discover(token, "?category=cLoThInG");
      assert.deepEqual(names(filtered), ["Tee", "Jeans"]);
      assert.equal(filtered.json.total, 2);
      assert.equal(filtered.json.trending[0].shopName, "Loaf", "trending ignores the filter");
      assert.deepEqual(filtered.json.categories, ["Bakery", "Clothing"]);

      assert.equal((await discover(token, "?category=All")).json.total, 3);
      assert.equal((await discover(token, "?category=Unknown")).json.total, 0);
    });

    it("pages without gaps or repeats and reports totals", async () => {
      for (let i = 0; i < 7; i += 1) await shop({ name: `Shop ${i}`, km: i });
      const { token } = await viewer();

      const pages = await Promise.all([0, 1, 2, 3].map((p) => discover(token, `?limit=3&page=${p}`)));
      assert.deepEqual(pages.map((p) => p.json.rooms.length), [3, 3, 1, 0]);
      assert.ok(pages.every((p) => p.json.total === 7 && p.json.totalPages === 3 && p.json.limit === 3));
      const all = pages.flatMap((p) => names(p));
      assert.deepEqual(all, [0, 1, 2, 3, 4, 5, 6].map((i) => `Shop ${i}`));
    });

    it("clamps oversized limits and survives malformed parameters", async () => {
      for (let i = 0; i < 3; i += 1) await shop({ name: `S${i}`, km: i });
      const { token } = await viewer();

      assert.equal((await discover(token, "?limit=100000")).json.limit, 30);
      for (const query of ["?page=-5", "?page=abc", "?limit=0", "?sort=sideways", "?category=" + "x".repeat(500), "?page=99999999"]) {
        const res = await discover(token, query);
        assert.equal(res.status, 200, query);
        assert.ok(Array.isArray(res.json.rooms), query);
      }
    });

    it("marks only the rooms the customer joined, and only looks at the current page", async () => {
      const a = await shop({ name: "Joined", km: 1 });
      await shop({ name: "Other", km: 2 });
      const me = await viewer();
      await t.prisma.membership.create({ data: { roomId: a.roomId, customerId: me.id } });

      const res = await discover(me.token);
      const byName = Object.fromEntries(res.json.rooms.map((r: { shopName: string; isJoined: boolean }) => [r.shopName, r.isJoined]));
      assert.deepEqual(byName, { Joined: true, Other: false });
    });

    it("marks a room active today only when it really had a message or a notification in the last day", async () => {
      await shop({ name: "Quiet", km: 1 });
      const stale = await shop({ name: "Stale", km: 2 });
      const chatty = await shop({ name: "Chatty", km: 3 });
      const deleted = await shop({ name: "Deleted", km: 4 });
      const notified = await shop({ name: "Notified", km: 5 });
      const message = (roomId: string, shopkeeperId: string, hoursAgo: number, deletedForEveryone = false) =>
        t.prisma.message.create({
          data: { roomId, senderType: "SHOPKEEPER", shopkeeperId, text: "hi", deletedForEveryone, createdAt: new Date(Date.now() - hoursAgo * 3_600_000) },
        });
      await message(stale.roomId, stale.shopkeeperId, 30);
      await message(chatty.roomId, chatty.shopkeeperId, 2);
      await message(deleted.roomId, deleted.shopkeeperId, 2, true);
      const design = await createDesign(t.prisma, notified.shopkeeperId);
      const version = await t.prisma.notificationDesignVersion.create({ data: { designId: design, version: 1, designJson: sampleDesign(), createdBy: notified.shopkeeperId } });
      await t.prisma.notificationSend.create({ data: { shopkeeperId: notified.shopkeeperId, roomId: notified.roomId, designVersionId: version.id, status: "SENT" } });

      const { token } = await viewer();
      const res = await discover(token);
      const active = Object.fromEntries(res.json.rooms.map((r: { shopName: string; activeToday: boolean }) => [r.shopName, r.activeToday]));
      assert.deepEqual(active, { Quiet: false, Stale: false, Chatty: true, Deleted: false, Notified: true });
    });

    it("keeps the response shape the web app reads", async () => {
      await shop({ name: "Shape", km: 1, members: 4 });
      const { token } = await viewer();
      const res = await discover(token);
      assert.deepEqual(Object.keys(res.json).sort(), ["categories", "limit", "page", "rooms", "total", "totalPages", "trending"]);
      assert.deepEqual(Object.keys(res.json.rooms[0]).sort(), [
        "activeToday", "category", "city", "coverUrl", "distanceKm", "inviteCode", "isJoined", "logoUrl", "membersCount", "roomId", "shopName",
      ]);
    });
  });

  describe("GET /api/rooms/map-pins", () => {
    it("returns pins, filters by bounding box and ignores a malformed box", async () => {
      await shop({ name: "Inside", km: 1 });
      await shop({ name: "Outside", km: 40 });
      await shop({ name: "Unplaced", km: null });
      const { token } = await viewer();

      const all = await t.call("GET", "/api/rooms/map-pins", { token });
      assert.deepEqual(all.json.pins.map((p: { shopName: string }) => p.shopName).sort(), ["Inside", "Outside"]);
      assert.equal(all.json.truncated, false);

      const box = `?swLat=${MUMBAI.latitude - 0.1}&swLng=${MUMBAI.longitude - 0.1}&neLat=${MUMBAI.latitude + 0.1}&neLng=${MUMBAI.longitude + 0.1}`;
      const inBox = await t.call("GET", `/api/rooms/map-pins${box}`, { token });
      assert.deepEqual(inBox.json.pins.map((p: { shopName: string }) => p.shopName), ["Inside"]);

      const malformed = await t.call("GET", "/api/rooms/map-pins?swLat=abc&neLat=9999&swLng=1&neLng=2", { token });
      assert.equal(malformed.status, 200);
      assert.equal(malformed.json.pins.length, 2);
    });

    it("revalidates with an ETag", async () => {
      await shop({ name: "Cached", km: 1 });
      const { token } = await viewer();
      const first = await t.call("GET", "/api/rooms/map-pins", { token });
      const etag = first.headers.get("etag");
      assert.ok(etag);
      assert.match(first.headers.get("cache-control") ?? "", /private, max-age=30/);
      const second = await t.call("GET", "/api/rooms/map-pins", { token, headers: { "If-None-Match": etag! } });
      assert.equal(second.status, 304);
    });

    it("never returns more than the pin cap, most popular first, and says so", async () => {
      const rows = Array.from({ length: 520 }, (_, i) => i);
      const owners = await t.prisma.shopkeeper.createManyAndReturn({
        data: rows.map((i) => ({
          email: `bulk${i}@example.test`, passwordHash: "x", shopName: `Bulk ${i}`, shopCategory: "Fashion",
          address: "1 Road", city: "Mumbai", state: "MH", pincode: "400001", phoneNumber: "+910000000000",
          planType: "1m", planExpiresAt: new Date(Date.now() + 86_400_000),
        })),
        select: { id: true },
      });
      const shops = await t.prisma.shop.createManyAndReturn({
        data: owners.map((o, i) => ({
          ownerId: o.id, shopName: `Bulk ${i}`, category: "Fashion", address: "1 Road", city: "Mumbai", state: "MH",
          pincode: "400001", phoneNumber: "+910000000000", ...at(i % 40),
        })),
        select: { id: true },
      });
      await t.prisma.room.createMany({
        data: shops.map((s, i) => ({ shopId: s.id, inviteCode: `BULK${String(i).padStart(5, "0")}`, membersCount: i })),
      });
      const { token } = await viewer();

      const res = await t.call("GET", "/api/rooms/map-pins", { token });
      assert.equal(res.json.pins.length, 500);
      assert.equal(res.json.truncated, true);
      const counts: number[] = res.json.pins.map((p: { membersCount: number }) => p.membersCount);
      assert.equal(counts[0], 519, "the most popular shop leads");
      assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
    });
  });

  describe("GET /api/rooms/:roomId/members", () => {
    async function crowd(size: number) {
      const room = await shop({ name: "Crowded", km: 0 });
      const base = Date.now() - size * 60_000;
      const customers = await t.prisma.customer.createManyAndReturn({
        data: Array.from({ length: size }, (_, i) => ({
          fullName: `Member ${i}`, email: `member${i}@example.test`, passwordHash: "x",
          allowLocationAccess: i % 2 === 0, latitude: i % 2 === 0 ? at(5).latitude : null, longitude: i % 2 === 0 ? at(5).longitude : null,
        })),
        select: { id: true, fullName: true },
      });
      await t.prisma.membership.createMany({
        data: customers.map((c, i) => ({ roomId: room.roomId, customerId: c.id, joinedAt: new Date(base + i * 60_000) })),
      });
      return { room, customers };
    }

    it("pages newest first and reports the full count", async () => {
      const { room } = await crowd(25);
      const owner = t.shopkeeperToken(room.shopkeeperId);
      const first = await t.call("GET", `/api/rooms/${room.roomId}/members?limit=10`, { token: owner });
      assert.equal(first.status, 200);
      assert.equal(first.json.members.length, 10);
      assert.equal(first.json.total, 25);
      assert.equal(first.json.hasMore, true);
      assert.equal(first.json.members[0].customerName, "Member 24", "newest first");

      const last = await t.call("GET", `/api/rooms/${room.roomId}/members?limit=10&page=2`, { token: owner });
      assert.equal(last.json.members.length, 5);
      assert.equal(last.json.hasMore, false);

      const names = [first, await t.call("GET", `/api/rooms/${room.roomId}/members?limit=10&page=1`, { token: owner }), last]
        .flatMap((r) => r.json.members.map((m: { customerName: string }) => m.customerName));
      assert.equal(new Set(names).size, 25, "no member is repeated or skipped");
    });

    it("caps the page size and shares distance only for members who allowed it", async () => {
      const { room } = await crowd(4);
      const owner = t.shopkeeperToken(room.shopkeeperId);
      const res = await t.call("GET", `/api/rooms/${room.roomId}/members?limit=100000`, { token: owner });
      assert.equal(res.json.limit, 500);
      const byName = Object.fromEntries(res.json.members.map((m: { customerName: string; distanceKm: number | null }) => [m.customerName, m.distanceKm]));
      assert.ok(byName["Member 0"] !== null && byName["Member 2"] !== null, "consenting members have a distance");
      assert.equal(byName["Member 1"], null);
      assert.equal(byName["Member 3"], null);
    });

    it("still refuses people outside the room", async () => {
      const { room } = await crowd(2);
      const stranger = await viewer();
      assert.equal((await t.call("GET", `/api/rooms/${room.roomId}/members`, { token: stranger.token })).status, 403);
    });
  });
});
