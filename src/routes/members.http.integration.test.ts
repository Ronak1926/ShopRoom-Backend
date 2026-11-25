import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();

describe("GET /api/shop/members", { skip: !enabled }, () => {
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

  async function shopWithMembers(members: { name: string; email?: string; notifications?: boolean; joinedDaysAgo?: number }[]) {
    const shop = await createShop(t.prisma);
    for (const m of members) {
      const c = await createCustomer(t.prisma, {
        member: { roomId: shop.roomId, notificationsEnabled: m.notifications ?? true, joinedAt: new Date(Date.now() - (m.joinedDaysAgo ?? 0) * 86_400_000) },
      });
      await t.prisma.customer.update({ where: { id: c.customerId }, data: { fullName: m.name, ...(m.email ? { email: m.email } : {}) } });
    }
    return { ...shop, token: t.shopkeeperToken(shop.shopkeeperId) };
  }
  const list = (token: string, query = "") => t.call("GET", `/api/shop/members${query}`, { token });
  const names = (res: { json: { members: { customerName: string }[] } }) => res.json.members.map((m) => m.customerName);

  it("lists members newest first with the fields the table shows", async () => {
    const s = await shopWithMembers([
      { name: "Old Member", joinedDaysAgo: 9 },
      { name: "New Member", joinedDaysAgo: 1, notifications: false },
    ]);
    const res = await list(s.token);
    assert.equal(res.status, 200);
    assert.deepEqual(names(res), ["New Member", "Old Member"]);
    assert.deepEqual(Object.keys(res.json.members[0]).sort(), ["customerId", "customerName", "email", "id", "joinedAt", "notificationsEnabled"]);
    assert.equal(res.json.total, 2);
    assert.equal(res.json.members[0].notificationsEnabled, false);
  });

  it("pages through members", async () => {
    const s = await shopWithMembers(Array.from({ length: 5 }, (_, i) => ({ name: `Member ${i}`, joinedDaysAgo: i })));
    const first = await list(s.token, "?limit=2&page=0");
    const last = await list(s.token, "?limit=2&page=2");
    assert.deepEqual(names(first), ["Member 0", "Member 1"]);
    assert.deepEqual(names(last), ["Member 4"]);
    assert.equal(first.json.totalPages, 3);
    assert.equal(first.json.total, 5);
  });

  it("searches name or email, ignoring case, and counts only the matches", async () => {
    const s = await shopWithMembers([
      { name: "Asha Rao", email: "asha@example.test" },
      { name: "Ravi Kumar", email: "rk@mail.test" },
      { name: "Meera", email: "meera@asha-shop.test" },
    ]);
    const byName = await list(s.token, "?q=RAO");
    assert.deepEqual(names(byName), ["Asha Rao"]);
    const byEmail = await list(s.token, "?q=asha");
    assert.deepEqual(names(byEmail).sort(), ["Asha Rao", "Meera"]);
    assert.equal(byEmail.json.total, 2);
    assert.equal((await list(s.token, "?q=nobody")).json.total, 0);
  });

  it("treats % and _ in a search as plain characters", async () => {
    const s = await shopWithMembers([{ name: "Plain Name" }, { name: "100% Fan" }]);
    assert.deepEqual(names(await list(s.token, "?q=%25")), ["100% Fan"], "only the member who really has a percent sign");
    assert.equal((await list(s.token, "?q=Plai_%20Name")).json.total, 0, "underscore is not a one-character wildcard");
  });

  it("filters by whether notifications are on", async () => {
    const s = await shopWithMembers([
      { name: "On", notifications: true },
      { name: "Off", notifications: false },
    ]);
    assert.deepEqual(names(await list(s.token, "?notifications=on")), ["On"]);
    assert.deepEqual(names(await list(s.token, "?notifications=off")), ["Off"]);
    assert.equal((await list(s.token, "")).json.total, 2);
  });

  it("rejects out-of-range paging and unknown filters", async () => {
    const s = await shopWithMembers([{ name: "A" }]);
    for (const query of ["?limit=0", "?limit=101", "?page=-1", "?page=abc", "?notifications=maybe", `?q=${"x".repeat(101)}`]) {
      assert.equal((await list(s.token, query)).status, 400, query);
    }
  });

  it("only ever shows the signed-in shop's own members", async () => {
    const mine = await shopWithMembers([{ name: "Mine" }]);
    await shopWithMembers([{ name: "Someone Else's" }]);
    assert.deepEqual(names(await list(mine.token)), ["Mine"]);
    assert.equal((await list(mine.token, "?q=Else")).json.total, 0);
  });

  it("needs a shopkeeper session", async () => {
    assert.equal((await t.call("GET", "/api/shop/members")).status, 401);
    const c = await createCustomer(t.prisma);
    assert.equal((await list(t.customerToken(c.customerId))).status, 401);
  });
});
