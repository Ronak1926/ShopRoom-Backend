/*
  Migrate shopAddress → address, city, state, pincode (split columns).
  Existing rows get the old shopAddress value copied into address;
  city, state, pincode default to empty string then become NOT NULL.
*/

-- Step 1: add new columns as nullable + optional geo columns
ALTER TABLE "Shopkeeper"
  ADD COLUMN "address"   TEXT,
  ADD COLUMN "city"      TEXT,
  ADD COLUMN "state"     TEXT,
  ADD COLUMN "pincode"   TEXT,
  ADD COLUMN "latitude"  DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;

-- Step 2: backfill existing rows — copy old shopAddress into address, leave others as ''
UPDATE "Shopkeeper"
SET "address" = "shopAddress",
    "city"    = '',
    "state"   = '',
    "pincode" = '';

-- Step 3: drop the old column
ALTER TABLE "Shopkeeper" DROP COLUMN "shopAddress";

-- Step 4: enforce NOT NULL now that all rows have values
ALTER TABLE "Shopkeeper"
  ALTER COLUMN "address" SET NOT NULL,
  ALTER COLUMN "city"    SET NOT NULL,
  ALTER COLUMN "state"   SET NOT NULL,
  ALTER COLUMN "pincode" SET NOT NULL;
