-- Query plans for the hot paths, to run against the database loaded by seedPerf.sql:
--   psql "$PERF_DATABASE_URL" -f scripts/loadtest/explain.sql
-- Each statement mirrors the SQL the service sends (see the file named above it).
\set ON_ERROR_STOP on
\pset pager off

\echo '== discover, nearest (services/roomDiscovery.service.ts)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT r."id",
  CASE WHEN s."latitude" IS NULL OR s."longitude" IS NULL THEN NULL ELSE
    12742 * asin(sqrt(least(1,
      power(sin(radians(s."latitude" - 19.076::float8) / 2), 2) +
      cos(radians(19.076::float8)) * cos(radians(s."latitude")) *
      power(sin(radians(s."longitude" - 72.8777::float8) / 2), 2)))) END AS "distance"
FROM "Room" r JOIN "Shop" s ON s."id" = r."shopId"
ORDER BY "distance" ASC NULLS LAST, r."id" ASC LIMIT 30 OFFSET 0;

\echo '== discover, popular'
EXPLAIN (ANALYZE, BUFFERS)
SELECT r."id" FROM "Room" r ORDER BY r."membersCount" DESC, r."id" ASC LIMIT 30 OFFSET 0;

\echo '== members of the busiest room, newest first (roomDiscovery.service.ts listRoomMembers)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT m."joinedAt", m."customerId" FROM "Membership" m
WHERE m."roomId" = (SELECT "id" FROM "Room" ORDER BY "membersCount" DESC LIMIT 1)
ORDER BY m."joinedAt" DESC, m."id" ASC LIMIT 200;

\echo '== chat history page (message.service.ts getMessages)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT m.* FROM "Message" m
WHERE m."roomId" = (SELECT "id" FROM "Room" ORDER BY "membersCount" DESC LIMIT 1)
ORDER BY m."createdAt" DESC LIMIT 30;

\echo '== map pins inside a bounding box (roomDiscovery.service.ts mapPinsFor)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT s."id" FROM "Shop" s JOIN "Room" r ON r."shopId" = s."id"
WHERE s."latitude" BETWEEN 18.9 AND 19.3 AND s."longitude" BETWEEN 72.6 AND 73.2
ORDER BY r."membersCount" DESC, s."id" LIMIT 501;

\echo '== audience: customers within 10 km of the shop (notificationAudience.service.ts)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT d."id", d."customerId", d."fcmToken"
FROM "CustomerDevice" d JOIN "Customer" c ON c."id" = d."customerId"
LEFT JOIN "Membership" m ON m."customerId" = c."id" AND m."roomId" = 'room1'
WHERE ((m."id" IS NOT NULL AND m."notificationsEnabled" = true)
   OR (m."id" IS NULL AND c."allowLocationAccess" = true AND c."locationUpdatedAt" >= now() - interval '48 hours'
       AND c."latitude" BETWEEN 18.98 AND 19.17 AND c."longitude" BETWEEN 72.78 AND 72.98
       AND 2 * 6371 * asin(least(1, sqrt(power(sin(radians(c."latitude" - 19.076) / 2), 2) + cos(radians(19.076)) * cos(radians(c."latitude")) * power(sin(radians(c."longitude" - 72.8777) / 2), 2)))) <= 10))
ORDER BY d."id" LIMIT 50000;

\echo '== my rooms (customers.service.ts getJoinedRooms)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT m."roomId", m."joinedAt" FROM "Membership" m WHERE m."customerId" = 'cust12345' ORDER BY m."joinedAt" DESC LIMIT 200;
