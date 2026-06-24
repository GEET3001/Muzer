-- Directional votes: add a signed value so a row can represent either an
-- upvote (+1) or a downvote (-1). Existing rows were upvotes, so default to 1.
-- The existing unique (userId, streamId) still enforces one vote per user
-- per stream; only its direction can change now.
ALTER TABLE "public"."Upvotes" ADD COLUMN "value" INTEGER NOT NULL DEFAULT 1;
