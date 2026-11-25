-- Synthetic data at a scale the demo database does not have. Load it into a
-- scratch database whose name contains "test" (see docs/ops/PERFORMANCE.md):
--   2,000 shops/rooms, 200,000 customers (60% share a location, 1 device each),
--   ~600,000 memberships, 500,000 chat messages.
-- Positions are scattered over India; one in four shops sits in a Mumbai cluster.
\set ON_ERROR_STOP on
\timing on

INSERT INTO "Shopkeeper" ("id","email","passwordHash","shopName","shopCategory","address","city","state","pincode","phoneNumber","planType","planExpiresAt","updatedAt")
SELECT 'sk' || g, 'owner' || g || '@perf.test', 'x', 'Shop ' || g,
       (ARRAY['Fashion','Bakery','Electronics','Grocery','Pharmacy','Books'])[1 + g % 6],
       '1 Road', 'City', 'ST', '400001', '+910000000000', '3m', now() + interval '30 days', now()
FROM generate_series(1, 2000) g;

INSERT INTO "Shop" ("id","ownerId","shopName","category","address","city","state","pincode","phoneNumber","latitude","longitude","updatedAt")
SELECT 'shop' || g, 'sk' || g, 'Shop ' || g,
       (ARRAY['Fashion','Bakery','Electronics','Grocery','Pharmacy','Books'])[1 + g % 6],
       '1 Road', 'City', 'ST', '400001', '+910000000000',
       CASE WHEN g % 4 = 0 THEN 19.0 + random() * 0.4 ELSE 8 + random() * 20 END,
       CASE WHEN g % 4 = 0 THEN 72.7 + random() * 0.4 ELSE 72 + random() * 16 END,
       now()
FROM generate_series(1, 2000) g;

INSERT INTO "Room" ("id","shopId","inviteCode","membersCount","updatedAt")
SELECT 'room' || g, 'shop' || g, 'PERF' || lpad(g::text, 6, '0'), 0, now()
FROM generate_series(1, 2000) g;

INSERT INTO "Customer" ("id","fullName","email","passwordHash","allowLocationAccess","latitude","longitude","locationUpdatedAt","updatedAt")
SELECT 'cust' || g, 'Customer ' || g, 'c' || g || '@perf.test', 'x', g % 5 < 3,
       CASE WHEN g % 5 < 3 THEN 8 + random() * 20 END,
       CASE WHEN g % 5 < 3 THEN 72 + random() * 16 END,
       CASE WHEN g % 5 < 3 THEN now() - (random() * interval '40 hours') END,
       now()
FROM generate_series(1, 200000) g;

-- Rooms are not equally popular: squaring the random number skews joins toward low room numbers.
INSERT INTO "Membership" ("id","roomId","customerId","joinedAt")
SELECT DISTINCT ON (c, r) 'm' || row_number() OVER (), 'room' || r, 'cust' || c, now() - random() * interval '400 days'
FROM (
  SELECT c, 1 + floor(power(random(), 2) * 2000)::int AS r
  FROM generate_series(1, 200000) c, generate_series(1, 3) k
) pairs;

UPDATE "Room" r SET "membersCount" = m.n FROM (SELECT "roomId", count(*) n FROM "Membership" GROUP BY 1) m WHERE m."roomId" = r."id";

INSERT INTO "CustomerDevice" ("id","customerId","fcmToken")
SELECT 'dev' || g, 'cust' || g, 'perf-token-' || g || '-' || md5(g::text) FROM generate_series(1, 200000) g;

INSERT INTO "Message" ("id","roomId","senderType","customerId","text","createdAt")
SELECT 'msg' || g, 'room' || (1 + floor(power(random(), 2) * 2000)::int), 'CUSTOMER', 'cust' || (1 + (g % 200000)), 'encrypted-placeholder-text-' || g,
       now() - random() * interval '90 days'
FROM generate_series(1, 500000) g;

ANALYZE;
SELECT 'customers' AS what, count(*) FROM "Customer" UNION ALL SELECT 'memberships', count(*) FROM "Membership"
UNION ALL SELECT 'messages', count(*) FROM "Message" UNION ALL SELECT 'rooms', count(*) FROM "Room" ORDER BY 1;
