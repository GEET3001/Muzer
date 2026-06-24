-- Two-code auth: add the secret access code (second factor) to Session.
-- Use a temporary default so the NOT NULL column applies cleanly to any
-- existing rows, then drop the default so new rows must supply a value.
ALTER TABLE "public"."Session" ADD COLUMN "accessCode" TEXT NOT NULL DEFAULT '000000';
ALTER TABLE "public"."Session" ALTER COLUMN "accessCode" DROP DEFAULT;
