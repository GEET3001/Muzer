-- Pin the currently-playing track per session so votes reorder only the
-- upcoming queue, never swap the song that's already playing on the deck.
ALTER TABLE "public"."Session" ADD COLUMN "currentStreamId" TEXT;
