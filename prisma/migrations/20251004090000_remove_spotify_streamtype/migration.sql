-- Drop the unused 'Spotify' value from StreamType. Postgres has no
-- "ALTER TYPE ... DROP VALUE", so recreate the enum with only 'Youtube' and
-- swap the column over. Safe because every Stream row is 'Youtube' (the only
-- value the app ever writes), so the cast can't fail.
ALTER TYPE "public"."StreamType" RENAME TO "StreamType_old";

CREATE TYPE "public"."StreamType" AS ENUM ('Youtube');

ALTER TABLE "public"."Stream"
  ALTER COLUMN "type" TYPE "public"."StreamType"
  USING ("type"::text::"public"."StreamType");

DROP TYPE "public"."StreamType_old";
