import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createDesign, createShop, integrationConfigured, resetDatabase, sampleDesign } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();
const DAY = 86_400_000;

describe("analytics and send history", { skip: !enabled }, () => {
  let t: TestApp;

  before(async () => {
    process.env.APP_TIMEZONE = "UTC";
    t = await startTestApp();
  });
  after(async () => {
    delete process.env.APP_TIMEZONE;
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
  });

  async function shop() {
    const made = await createShop(t.prisma);
    const designId = await createDesign(t.prisma, made.shopkeeperId);
    const version = await t.prisma.notificationDesignVersion.create({
      data: { designId, version: 1, designJson: sampleDesign(), createdBy: made.shopkeeperId },
    });
    return { ...made, designId, versionId: version.id, token: t.shopkeeperToken(made.shopkeeperId) };
  }

  /** Inserts a finished send `daysAgo` days back (noon UTC, so day boundaries are unambiguous). */
  async function send(
    s: { shopkeeperId: string; roomId: string; versionId: string },
    daysAgo: number,
    counts: { sent: number; delivered: number; opened: number; clicked: number },
    extra: { status?: "SENT" | "FAILED" | "PENDING"; message?: string; versionId?: string } = {},
  ) {
    const at = new Date(Date.now() - daysAgo * DAY);
    at.setUTCHours(12, 0, 0, 0);
    if (daysAgo === 0 && at.getTime() > Date.now()) at.setTime(Date.now() - 60_000);
    return t.prisma.notificationSend.create({
      data: {
        shopkeeperId: s.shopkeeperId,
        roomId: s.roomId,
        designVersionId: extra.versionId ?? s.versionId,
        status: extra.status ?? "SENT",
        message: extra.message ?? "msg",
        recipientCount: counts.sent,
        successCount: counts.sent,
        deliveredCount: counts.delivered,
        openedCount: counts.opened,
        clickedCount: counts.clicked,
        createdAt: at,
      },
    });
  }

  describe("GET /api/notifications/analytics", () => {
    it("adds up real sends into totals, rates and a gap-free daily series", async () => {
      const s = await shop();
      await send(s, 0, { sent: 100, delivered: 90, opened: 45, clicked: 9 });
      await send(s, 2, { sent: 50, delivered: 40, opened: 20, clicked: 4 });
      await send(s, 2, { sent: 50, delivered: 50, opened: 5, clicked: 1 });

      const res = await t.call("GET", "/api/notifications/analytics?days=7", { token: s.token });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const a = res.json.data;
      assert.deepEqual(a.totals, { sent: 200, delivered: 180, opened: 70, clicked: 14 });
      assert.deepEqual(a.rates, { delivery: 90, open: 38.9, click: 7.8 });
      assert.equal(a.sends, 3);
      assert.equal(a.series.length, 7);
      assert.deepEqual(a.series.map((p: { date: string }) => p.date), [...a.series.map((p: { date: string }) => p.date)].sort(), "oldest first");
      assert.equal(new Set(a.series.map((p: { date: string }) => p.date)).size, 7, "one point per day");
      assert.deepEqual(a.series[6], { date: a.series[6].date, sent: 100, delivered: 90, opened: 45, clicked: 9 });
      assert.deepEqual(a.series[4], { date: a.series[4].date, sent: 100, delivered: 90, opened: 25, clicked: 5 });
      assert.deepEqual(a.series[5], { date: a.series[5].date, sent: 0, delivered: 0, opened: 0, clicked: 0 }, "quiet days are zero, not missing");
    });

    it("compares against the previous period of the same length", async () => {
      const s = await shop();
      await send(s, 1, { sent: 150, delivered: 150, opened: 60, clicked: 30 });
      await send(s, 8, { sent: 100, delivered: 100, opened: 60, clicked: 10 });
      const a = (await t.call("GET", "/api/notifications/analytics?days=7", { token: s.token })).json.data;
      assert.deepEqual(a.deltas, { sent: 50, delivered: 50, opened: 0, clicked: 200 });
    });

    it("counts nothing for sends outside the window or still in flight, and shows zeros when empty", async () => {
      const s = await shop();
      await send(s, 20, { sent: 999, delivered: 999, opened: 999, clicked: 999 });
      await send(s, 0, { sent: 77, delivered: 0, opened: 0, clicked: 0 }, { status: "PENDING" });
      const a = (await t.call("GET", "/api/notifications/analytics?days=7", { token: s.token })).json.data;
      assert.deepEqual(a.totals, { sent: 0, delivered: 0, opened: 0, clicked: 0 });
      assert.deepEqual(a.rates, { delivery: 0, open: 0, click: 0 });
      assert.deepEqual(a.deltas, { sent: 0, delivered: 0, opened: 0, clicked: 0 });
      assert.deepEqual(a.insights, { membersTotal: 0, activeMembers: 0, returningMembers: 0, engagementScore: 0 });
    });

    it("supports other windows and rejects silly ones", async () => {
      const s = await shop();
      assert.equal((await t.call("GET", "/api/notifications/analytics?days=30", { token: s.token })).json.data.series.length, 30);
      assert.equal((await t.call("GET", "/api/notifications/analytics", { token: s.token })).json.data.days, 7, "default");
      for (const days of ["0", "-1", "91", "abc", "7.5"]) assert.equal((await t.call("GET", `/api/notifications/analytics?days=${days}`, { token: s.token })).status, 400, days);
    });

    it("never mixes in another shop's numbers", async () => {
      const a = await shop();
      const b = await shop();
      await send(a, 0, { sent: 10, delivered: 10, opened: 5, clicked: 1 });
      await send(b, 0, { sent: 5000, delivered: 5000, opened: 4000, clicked: 900 });
      assert.equal((await t.call("GET", "/api/notifications/analytics", { token: a.token })).json.data.totals.sent, 10);
    });

    it("names the best designs by open rate, and measures engaged members from real receipts", async () => {
      const s = await shop();
      const other = await t.prisma.notificationDesign.create({ data: { shopkeeperId: s.shopkeeperId, name: "Flash sale", designJson: sampleDesign() }, select: { id: true } });
      const otherVersion = await t.prisma.notificationDesignVersion.create({ data: { designId: other.id, version: 1, designJson: sampleDesign(), createdBy: s.shopkeeperId } });
      const weak = await send(s, 1, { sent: 100, delivered: 100, opened: 10, clicked: 1 });
      const strong = await send(s, 1, { sent: 100, delivered: 100, opened: 80, clicked: 20 }, { versionId: otherVersion.id });

      const members = await Promise.all(Array.from({ length: 4 }, () => createCustomer(t.prisma, { member: { roomId: s.roomId }, devices: 1 })));
      await t.prisma.room.update({ where: { id: s.roomId }, data: { membersCount: 4 } });
      const opened = (sendId: string, customer: (typeof members)[number], n: number) =>
        t.prisma.notificationSendRecipient.create({
          data: { sendId, customerId: customer.customerId, deviceId: customer.deviceIds[0], receiptToken: `${sendId}-${customer.customerId}-${n}`, status: "SENT", openedAt: new Date(Date.now() - DAY) },
        });
      // Members 0 and 1 opened this period (0 opened both sends); member 2 opened long ago; member 3 never.
      await opened(weak.id, members[0], 1);
      await opened(strong.id, members[0], 2);
      await opened(strong.id, members[1], 3);
      await t.prisma.notificationSendRecipient.create({
        data: { sendId: weak.id, customerId: members[2].customerId, deviceId: members[2].deviceIds[0], receiptToken: "old", status: "SENT", openedAt: new Date(Date.now() - 40 * DAY) },
      });

      const a = (await t.call("GET", "/api/notifications/analytics?days=7", { token: s.token })).json.data;
      assert.deepEqual(a.topDesigns.map((d: { name: string; openRate: number; clickRate: number }) => [d.name, d.openRate, d.clickRate]), [["Flash sale", 80, 20], ["Test banner", 10, 1]]);
      assert.equal(a.topDesigns[0].designId, other.id);
      assert.deepEqual(a.insights, { membersTotal: 4, activeMembers: 2, returningMembers: 1, engagementScore: 50 });
    });

    it("needs a shopkeeper session", async () => {
      assert.equal((await t.call("GET", "/api/notifications/analytics")).status, 401);
    });
  });

  describe("GET /api/notifications/sends filters", () => {
    async function history(s: { token: string }, query = "") {
      return (await t.call("GET", `/api/notifications/sends${query}`, { token: s.token })).json.data;
    }

    it("filters by outcome", async () => {
      const s = await shop();
      await send(s, 1, { sent: 10, delivered: 10, opened: 0, clicked: 0 }, { message: "only delivered" });
      await send(s, 1, { sent: 10, delivered: 10, opened: 5, clicked: 0 }, { message: "opened" });
      await send(s, 1, { sent: 10, delivered: 10, opened: 5, clicked: 2 }, { message: "clicked" });
      await send(s, 1, { sent: 0, delivered: 0, opened: 0, clicked: 0 }, { message: "failed", status: "FAILED" });
      const messages = async (outcome: string) => (await history(s, `?outcome=${outcome}`)).items.map((i: { message: string }) => i.message).sort();
      assert.deepEqual(await messages("all"), ["clicked", "failed", "only delivered", "opened"]);
      assert.deepEqual(await messages("failed"), ["failed"]);
      assert.deepEqual(await messages("opened"), ["clicked", "opened"]);
      assert.deepEqual(await messages("clicked"), ["clicked"]);
      assert.deepEqual(await messages("delivered"), ["clicked", "only delivered", "opened"]);
    });

    it("searches the message and the design name, ignoring case", async () => {
      const s = await shop();
      await send(s, 1, { sent: 1, delivered: 1, opened: 0, clicked: 0 }, { message: "Diwali OFFER" });
      await send(s, 2, { sent: 1, delivered: 1, opened: 0, clicked: 0 }, { message: "restock" });
      assert.equal((await history(s, "?q=diwali")).total, 1);
      assert.equal((await history(s, "?q=test%20banner")).total, 2, "design name");
      assert.equal((await history(s, "?q=nothing-like-this")).total, 0);
      assert.equal((await history(s, "?q=%25")).total, 0, "wildcards are not special");
      assert.equal((await history(s, "?q=resto_k")).total, 0, "underscore is not a single-character wildcard");
      await send(s, 1, { sent: 1, delivered: 1, opened: 0, clicked: 0 }, { message: "50% off_today" });
      assert.equal((await history(s, "?q=%25%20off_")).total, 1, "but literal % and _ still match themselves");
    });

    it("sorts, pages and limits to a date range, and says which design each row is", async () => {
      const s = await shop();
      await send(s, 1, { sent: 1, delivered: 1, opened: 1, clicked: 0 }, { message: "few opens" });
      await send(s, 3, { sent: 1, delivered: 1, opened: 9, clicked: 7 }, { message: "many opens" });
      await send(s, 20, { sent: 1, delivered: 1, opened: 50, clicked: 50 }, { message: "ancient" });
      const order = async (query: string) => (await history(s, query)).items.map((i: { message: string }) => i.message);
      assert.deepEqual(await order("?sort=latest&days=7"), ["few opens", "many opens"]);
      assert.deepEqual(await order("?sort=oldest"), ["ancient", "many opens", "few opens"]);
      assert.deepEqual(await order("?sort=opens"), ["ancient", "many opens", "few opens"]);
      assert.deepEqual(await order("?sort=clicks&days=7"), ["many opens", "few opens"]);
      const page = await history(s, "?limit=2&page=2");
      assert.equal(page.items.length, 1);
      assert.equal(page.total, 3);
      assert.equal(page.items[0].designId, s.designId);
    });

    it("rejects unknown filters and over-long searches", async () => {
      const s = await shop();
      for (const query of ["?outcome=weird", "?sort=random", `?q=${"x".repeat(101)}`, "?days=0", "?days=999"]) {
        assert.equal((await t.call("GET", `/api/notifications/sends${query}`, { token: s.token })).status, 400, query);
      }
    });

    it("stays scoped to the signed-in shop", async () => {
      const a = await shop();
      const b = await shop();
      await send(b, 1, { sent: 1, delivered: 1, opened: 0, clicked: 0 }, { message: "secret of b" });
      assert.equal((await history(a, "?q=secret")).total, 0);
    });
  });
});
