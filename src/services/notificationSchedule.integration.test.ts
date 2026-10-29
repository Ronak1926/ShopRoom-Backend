import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  connectTestEnvironment,
  createCustomer,
  createDesign,
  createShop,
  integrationConfigured,
  resetDatabase,
  stubSendEach,
  type TestMessaging,
  type TestPrisma,
} from "../test/integration.js";
import { NotificationError } from "../utils/notificationError.js";
import type { CreateScheduleInput } from "../schemas/notificationScheduleRequest.schema.js";

const enabled = integrationConfigured();
const HOUR = 3_600_000;

describe("scheduled sends", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let messaging: TestMessaging;
  let svc: typeof import("./notificationSchedule.service.js");
  let runDueSchedules: typeof import("./notificationScheduler.service.js").runDueSchedules;
  let stub: ReturnType<typeof stubSendEach>;

  before(async () => {
    ({ prisma, firebaseMessaging: messaging } = await connectTestEnvironment());
    svc = await import("./notificationSchedule.service.js");
    ({ runDueSchedules } = await import("./notificationScheduler.service.js"));
  });

  after(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    stub = stubSendEach(messaging);
  });

  afterEach(() => stub.restore());

  function input(
    designId: string,
    overrides: {
      audience?: Partial<CreateScheduleInput["audience"]>;
      schedule?: Partial<CreateScheduleInput["schedule"]>;
      message?: string;
    } = {},
  ): CreateScheduleInput {
    return {
      source: "DESIGN",
      notificationId: designId,
      message: overrides.message,
      audience: {
        includeMembers: true,
        includeNearby: false,
        radiusKm: 10,
        includeFutureMembers: true,
        skipNotificationsOff: true,
        ...overrides.audience,
      },
      schedule: {
        sendAt: new Date(Date.now() + HOUR).toISOString(),
        timeZone: "Asia/Kolkata",
        recurrence: "ONCE",
        repeatEvery: 1,
        weekdays: [],
        endMode: "NEVER",
        endDate: null,
        endAfter: null,
        deliverySpeed: "STANDARD",
        ...overrides.schedule,
      },
    };
  }

  /** Pretends the schedule's next run is due `agoMs` ago. */
  async function makeDue(scheduleId: string, agoMs = 60_000) {
    const at = new Date(Math.floor((Date.now() - agoMs) / 60_000) * 60_000);
    await prisma.notificationSchedule.update({
      where: { id: scheduleId },
      data: { nextRunAt: at, firstRunAt: at, lockedUntil: null },
    });
    return at;
  }

  async function setup(options: { planType?: string; members?: number } = {}) {
    const shop = await createShop(prisma, { planType: options.planType });
    const designId = await createDesign(prisma, shop.shopkeeperId);
    const members = await Promise.all(
      Array.from({ length: options.members ?? 1 }, () =>
        createCustomer(prisma, { member: { roomId: shop.roomId } }),
      ),
    );
    return { ...shop, designId, members };
  }

  describe("creating", () => {
    it("pins the design version and queues the first run", async () => {
      const { shopkeeperId, designId } = await setup();
      const body = input(designId);
      const created = await svc.createSchedule(shopkeeperId, body);
      const minute = Math.floor(new Date(body.schedule.sendAt).getTime() / 60_000) * 60_000;
      assert.equal(created.nextRunAt, new Date(minute).toISOString());

      const row = await prisma.notificationSchedule.findUniqueOrThrow({
        where: { id: created.id },
        include: { designVersion: true },
      });
      assert.equal(row.status, "ACTIVE");
      assert.equal(row.designVersion.designId, designId);
    });

    it("rejects a time in the past", async () => {
      const { shopkeeperId, designId } = await setup();
      await assert.rejects(
        () =>
          svc.createSchedule(
            shopkeeperId,
            input(designId, { schedule: { sendAt: new Date(Date.now() - HOUR).toISOString() } }),
          ),
        (err: unknown) => err instanceof NotificationError && err.status === 400,
      );
    });

    it("rejects a run more than a year away", async () => {
      const { shopkeeperId, designId } = await setup();
      await assert.rejects(
        () =>
          svc.createSchedule(
            shopkeeperId,
            input(designId, {
              schedule: { sendAt: new Date(Date.now() + 400 * 24 * HOUR).toISOString() },
            }),
          ),
        (err: unknown) => err instanceof NotificationError && err.status === 400,
      );
    });

    it("rejects a nearby audience when the shop has no saved location", async () => {
      const shop = await createShop(prisma, { location: null });
      const designId = await createDesign(prisma, shop.shopkeeperId);
      await assert.rejects(
        () =>
          svc.createSchedule(
            shop.shopkeeperId,
            input(designId, { audience: { includeNearby: true } }),
          ),
        (err: unknown) => err instanceof NotificationError && err.status === 400,
      );
    });

    it("caps how many live schedules a shop can hold", async () => {
      const { shopkeeperId, designId, roomId } = await setup();
      const first = await svc.createSchedule(shopkeeperId, input(designId));
      const template = await prisma.notificationSchedule.findUniqueOrThrow({
        where: { id: first.id },
      });
      await prisma.notificationSchedule.createMany({
        data: Array.from({ length: svc.MAX_LIVE_SCHEDULES - 1 }, () => ({
          shopkeeperId,
          roomId,
          designVersionId: template.designVersionId,
          timeZone: template.timeZone,
          firstRunAt: template.firstRunAt,
          nextRunAt: template.nextRunAt,
        })),
      });
      await assert.rejects(
        () => svc.createSchedule(shopkeeperId, input(designId)),
        (err: unknown) => err instanceof NotificationError && err.status === 429,
      );
    });

    it("will not schedule a design that belongs to someone else", async () => {
      const mine = await setup();
      const theirs = await setup();
      await assert.rejects(
        () => svc.createSchedule(mine.shopkeeperId, input(theirs.designId)),
        (err: unknown) => err instanceof NotificationError && err.status === 404,
      );
      assert.equal(await prisma.notificationSchedule.count(), 0);
    });
  });

  describe("running", () => {
    it("sends a due one-off schedule once, then completes it", async () => {
      const { shopkeeperId, designId, roomId, members } = await setup();
      const { id } = await svc.createSchedule(shopkeeperId, input(designId, { message: "Hi" }));
      const occurrence = await makeDue(id);

      assert.equal(await runDueSchedules(), 1);

      assert.equal(stub.messages().length, 1);
      assert.equal(
        (stub.messages()[0] as { token: string }).token,
        members[0].tokens[0],
      );
      const send = await prisma.notificationSend.findFirstOrThrow({ where: { scheduleId: id } });
      assert.equal(send.status, "SENT");
      assert.equal(send.roomId, roomId);
      assert.equal(send.message, "Hi");
      assert.equal(send.scheduledFor?.getTime(), occurrence.getTime());

      const schedule = await prisma.notificationSchedule.findUniqueOrThrow({ where: { id } });
      assert.equal(schedule.status, "COMPLETED");
      assert.equal(schedule.nextRunAt, null);
      assert.equal(schedule.runCount, 1);
      assert.equal(schedule.lockedUntil, null);

      assert.equal(await runDueSchedules(), 0, "nothing left to run");
      assert.equal(stub.messages().length, 1);
    });

    it("moves a daily schedule on to tomorrow at the same time", async () => {
      const { shopkeeperId, designId } = await setup();
      const { id } = await svc.createSchedule(
        shopkeeperId,
        input(designId, { schedule: { recurrence: "DAILY" } }),
      );
      const occurrence = await makeDue(id);
      await runDueSchedules();

      const schedule = await prisma.notificationSchedule.findUniqueOrThrow({ where: { id } });
      assert.equal(schedule.status, "ACTIVE");
      assert.equal(schedule.nextRunAt?.getTime(), occurrence.getTime() + 24 * HOUR);
    });

    it("does not run a schedule before its time", async () => {
      const { shopkeeperId, designId } = await setup();
      await svc.createSchedule(shopkeeperId, input(designId));
      assert.equal(await runDueSchedules(), 0);
      assert.equal(stub.messages().length, 0);
    });

    it("never double-sends when two workers race for the same schedule", async () => {
      const { shopkeeperId, designId } = await setup();
      const { id } = await svc.createSchedule(shopkeeperId, input(designId));
      await makeDue(id);

      const claimed = await Promise.all(Array.from({ length: 6 }, () => runDueSchedules()));
      assert.equal(claimed.reduce((a, b) => a + b, 0), 1);
      assert.equal(stub.messages().length, 1);
      assert.equal(await prisma.notificationSend.count({ where: { scheduleId: id } }), 1);
    });

    it("recovers after a crash without delivering the same occurrence twice", async () => {
      const { shopkeeperId, designId, roomId } = await setup();
      const { id } = await svc.createSchedule(
        shopkeeperId,
        input(designId, { schedule: { recurrence: "DAILY" } }),
      );
      const occurrence = await makeDue(id);
      const schedule = await prisma.notificationSchedule.findUniqueOrThrow({ where: { id } });
      // The previous attempt delivered, then died before advancing the schedule.
      await prisma.notificationSend.create({
        data: {
          shopkeeperId,
          roomId,
          designVersionId: schedule.designVersionId,
          audience: "ROOM_MEMBERS",
          scheduleId: id,
          scheduledFor: occurrence,
          status: "SENT",
        },
      });

      await runDueSchedules();

      assert.equal(stub.messages().length, 0, "no second delivery");
      assert.equal(await prisma.notificationSend.count({ where: { scheduleId: id } }), 1);
      const after = await prisma.notificationSchedule.findUniqueOrThrow({ where: { id } });
      assert.equal(after.nextRunAt?.getTime(), occurrence.getTime() + 24 * HOUR, "advanced");
    });

    it("records a missed run instead of sending a stale promo, and skips ahead", async () => {
      const { shopkeeperId, designId } = await setup();
      const { id } = await svc.createSchedule(
        shopkeeperId,
        input(designId, { schedule: { recurrence: "DAILY" } }),
      );
      await makeDue(id, 3 * HOUR);
      await runDueSchedules();

      assert.equal(stub.messages().length, 0);
      const send = await prisma.notificationSend.findFirstOrThrow({ where: { scheduleId: id } });
      assert.equal(send.status, "FAILED");
      assert.equal(send.failureReason, "MISSED_WINDOW");
      const schedule = await prisma.notificationSchedule.findUniqueOrThrow({ where: { id } });
      assert.ok(schedule.nextRunAt && schedule.nextRunAt.getTime() > Date.now());
    });

    it("records DAILY_LIMIT_REACHED when the plan allowance is already used", async () => {
      const { shopkeeperId, designId, roomId } = await setup({ planType: "1m" });
      const { id } = await svc.createSchedule(shopkeeperId, input(designId));
      const row = await prisma.notificationSchedule.findUniqueOrThrow({ where: { id } });
      await prisma.notificationSend.create({
        data: {
          shopkeeperId,
          roomId,
          designVersionId: row.designVersionId,
          audience: "ROOM_MEMBERS",
          status: "SENT",
        },
      });
      await makeDue(id);
      await runDueSchedules();

      assert.equal(stub.messages().length, 0);
      const send = await prisma.notificationSend.findFirstOrThrow({ where: { scheduleId: id } });
      assert.equal(send.failureReason, "DAILY_LIMIT_REACHED");
    });

    it("leaves out members who joined after scheduling when asked to", async () => {
      const { shopkeeperId, designId, roomId, members } = await setup();
      const { id } = await svc.createSchedule(
        shopkeeperId,
        input(designId, { audience: { includeFutureMembers: false } }),
      );
      await createCustomer(prisma, {
        member: { roomId, joinedAt: new Date(Date.now() + 1000) },
      });
      await makeDue(id);
      await runDueSchedules();

      assert.deepEqual(
        stub.messages().map((m) => (m as { token: string }).token),
        members[0].tokens,
      );
    });

    it("uses high urgency for priority delivery", async () => {
      const { shopkeeperId, designId } = await setup();
      const { id } = await svc.createSchedule(
        shopkeeperId,
        input(designId, { schedule: { deliverySpeed: "PRIORITY" } }),
      );
      await makeDue(id);
      await runDueSchedules();
      const headers = (stub.messages()[0] as { webpush?: { headers?: Record<string, string> } })
        .webpush?.headers;
      assert.equal(headers?.Urgency, "high");
    });
  });

  describe("stale sends", () => {
    it("fails a send stuck in PENDING so it stops counting against the daily limit", async () => {
      const { failStalePendingSends } = await import("./notificationScheduler.service.js");
      const { shopkeeperId, designId, roomId } = await setup({ planType: "1m" }); // 1 / day
      const { id } = await svc.createSchedule(shopkeeperId, input(designId));
      const { designVersionId } = await prisma.notificationSchedule.findUniqueOrThrow({
        where: { id },
        select: { designVersionId: true },
      });
      const base = { shopkeeperId, roomId, designVersionId, audience: "ROOM_MEMBERS" as const, status: "PENDING" as const };
      const stale = await prisma.notificationSend.create({
        data: { ...base, createdAt: new Date(Date.now() - 20 * 60_000) },
      });
      const fresh = await prisma.notificationSend.create({ data: base });

      assert.equal(await failStalePendingSends(), 1);
      const [staleAfter, freshAfter] = await Promise.all([
        prisma.notificationSend.findUniqueOrThrow({ where: { id: stale.id } }),
        prisma.notificationSend.findUniqueOrThrow({ where: { id: fresh.id } }),
      ]);
      assert.equal(staleAfter.status, "FAILED");
      assert.equal(staleAfter.failureReason, "STALE_PENDING");
      assert.equal(freshAfter.status, "PENDING", "a send still in progress is left alone");
    });
  });

  describe("managing", () => {
    it("pauses, resumes and cancels, only for the owner", async () => {
      const mine = await setup();
      const other = await setup();
      const { id } = await svc.createSchedule(
        mine.shopkeeperId,
        input(mine.designId, { schedule: { recurrence: "DAILY" } }),
      );

      await assert.rejects(
        () => svc.setScheduleStatus(other.shopkeeperId, id, "PAUSED"),
        (err: unknown) => err instanceof NotificationError && err.status === 404,
      );
      await assert.rejects(
        () => svc.cancelSchedule(other.shopkeeperId, id),
        (err: unknown) => err instanceof NotificationError && err.status === 404,
      );

      const paused = await svc.setScheduleStatus(mine.shopkeeperId, id, "PAUSED");
      assert.equal(paused.status, "PAUSED");
      await makeDue(id);
      assert.equal(await runDueSchedules(), 0, "a paused schedule never runs");

      const resumed = await svc.setScheduleStatus(mine.shopkeeperId, id, "ACTIVE");
      assert.equal(resumed.status, "ACTIVE");
      assert.ok(new Date(resumed.nextRunAt!).getTime() > Date.now(), "recomputed from now");

      await svc.cancelSchedule(mine.shopkeeperId, id);
      assert.equal(stub.messages().length, 0);
      await assert.rejects(
        () => svc.setScheduleStatus(mine.shopkeeperId, id, "ACTIVE"),
        (err: unknown) => err instanceof NotificationError && err.status === 404,
      );
    });

    it("resuming a finished one-off marks it completed instead of re-arming it", async () => {
      const { shopkeeperId, designId } = await setup();
      const { id } = await svc.createSchedule(shopkeeperId, input(designId));
      await svc.setScheduleStatus(shopkeeperId, id, "PAUSED");
      await prisma.notificationSchedule.update({
        where: { id },
        data: { firstRunAt: new Date(Date.now() - HOUR) },
      });
      const result = await svc.setScheduleStatus(shopkeeperId, id, "ACTIVE");
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.nextRunAt, null);
    });

    it("lists upcoming and completed separately, scoped to the shop", async () => {
      const mine = await setup();
      const other = await setup();
      const keep = await svc.createSchedule(mine.shopkeeperId, input(mine.designId));
      const gone = await svc.createSchedule(mine.shopkeeperId, input(mine.designId));
      await svc.createSchedule(other.shopkeeperId, input(other.designId));
      await svc.cancelSchedule(mine.shopkeeperId, gone.id);

      const upcoming = await svc.listSchedules(mine.shopkeeperId, {
        state: "upcoming",
        page: 1,
        limit: 20,
      });
      const completed = await svc.listSchedules(mine.shopkeeperId, {
        state: "completed",
        page: 1,
        limit: 20,
      });
      assert.deepEqual(upcoming.items.map((i) => i.id), [keep.id]);
      assert.deepEqual(completed.items.map((i) => i.id), [gone.id]);
      assert.equal(upcoming.items[0].designName, "Test banner");
    });
  });
});
