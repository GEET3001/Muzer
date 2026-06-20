# Database — setup & data-store analysis

## TL;DR

Muzer's data is **relational and consistency-critical**, so the persistent
store is **PostgreSQL (SQL)** via Prisma — that is the correct choice and is
already wired up. A **NoSQL** store (Redis) is *optional* and only adds value
for real-time fan-out, caching, presence, and rate-limiting. It is **not
required** for the app to work, because live updates currently use SWR polling.

---

## 1. How to set up / enter the database

You need a PostgreSQL instance and a `DATABASE_URL` in `.env`. Pick ONE of the
two paths below. (`.env` already exists with a generated `NEXTAUTH_SECRET` and a
ready Docker `DATABASE_URL`; you only need to start the DB and fill in Google
OAuth.) **Use `.env`, not `.env.local`** — the Prisma CLI reads `.env` only,
while Next.js reads both.

### Path A — Local Postgres with Docker (good for development)

1. Start **Docker Desktop** and wait until it says "Engine running".
2. Create the database container:
   ```bash
   docker run -d --name muzer-postgres \
     -e POSTGRES_USER=muzer -e POSTGRES_PASSWORD=muzer -e POSTGRES_DB=muzer \
     -p 5432:5432 postgres:16
   ```
3. `.env` is already set for this:
   ```
   DATABASE_URL="postgresql://muzer:muzer@localhost:5432/muzer?schema=public"
   ```
4. Apply the schema (creates all tables incl. the new `accessCode` column):
   ```bash
   npx prisma migrate deploy      # or: npx prisma migrate dev
   ```
5. (Optional) Inspect data visually:
   ```bash
   npx prisma studio
   ```

To stop / remove later: `docker stop muzer-postgres` / `docker rm -f muzer-postgres`.

### Path B — Hosted Postgres with Neon (good for production / no Docker)

Neon is serverless Postgres and is already implied by the `@prisma/adapter-neon`
dependency. It needs no local daemon.

1. Create a free project at https://neon.tech and copy the connection string.
2. Put it in `.env` (and in your host's env vars for deploy):
   ```
   DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require"
   ```
3. `npx prisma migrate deploy`

Other managed Postgres (Supabase, RDS, Railway, Render) work identically — only
the connection string changes.

### Still required for sign-in
Google OAuth credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) from the
[Google Cloud Console](https://console.cloud.google.com) → Credentials →
OAuth client ID, with redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`.
Without these you can't complete a login; without `NEXTAUTH_SECRET` the auth
endpoint hangs (already generated for you in `.env`).

---

## 2. SQL vs NoSQL — analysis of this app

### The data and how it's accessed

| Entity         | Relationships / constraints                                   | Access pattern |
|----------------|---------------------------------------------------------------|----------------|
| `User`         | unique `email`; owns sessions, streams, upvotes               | lookup by email |
| `Session`      | unique `code`; `accessCode`; `hostId → User`                  | lookup by code; "host's latest" |
| `SessionMember`| **composite unique** `(sessionId, userId)`; FKs to both       | membership check (two-code auth) |
| `Stream`       | FKs to session + host + addedBy                               | list-by-session, join with upvotes |
| `Upvotes`      | **composite unique** `(userId, streamId)`; FKs to both        | dedup votes, count per stream |

Every core operation depends on things SQL gives you for free and NoSQL makes
you hand-build:

- **Referential integrity** — deleting a stream must clear its upvotes
  (the DELETE route relies on FK-safe ordering); members reference sessions;
  streams reference users.
- **Unique constraints** — `Session.code` must be globally unique; one upvote
  per (user, stream); one membership per (session, user). These composite
  uniques are what make voting idempotent and membership a simple upsert.
- **Multi-row consistency** — skip/remove deletes upvotes + stream in a single
  **transaction**.
- **Joins + aggregation** — the queue is "streams for a session, joined with
  upvotes, ordered by vote count". That's a textbook relational query.

➡️ **Conclusion: the persistent core belongs in SQL (PostgreSQL). Keep it.**
Modeling this in a document/NoSQL store would force manual integrity checks,
manual uniqueness enforcement, and duplicated/denormalized vote counts that
drift — strictly worse here.

### Where NoSQL *would* legitimately help (optional, not built)

These are **complements**, not replacements, for Postgres:

1. **Real-time updates (Redis Pub/Sub or a hosted realtime service).**
   Today the queue refreshes via SWR polling every 2 s. That's fine for small
   rooms but is O(viewers) requests. A Redis pub/sub channel per session (or
   Pusher/Ably/Supabase Realtime) pushing "queue changed" events would cut
   latency and load. *Ephemeral, high-fan-out → good NoSQL/in-memory fit.*

2. **Caching YouTube metadata (Redis key-value).**
   `GetVideoDetails` is the slow part of adding a track. Cache
   `videoId → {title, thumbnails}` with a TTL to avoid repeat lookups.

3. **Presence — "who's listening" (Redis sets / TTL keys).**
   Live, expiring, not worth a relational table or migrations.

4. **Rate limiting (Redis counters).**
   Throttle add/vote spam with `INCR` + expiry — a classic Redis use case.

### Recommendation

- **Now:** PostgreSQL only. It covers 100% of current functionality correctly.
- **When you add live push / scale rooms:** introduce **Redis** for pub/sub,
  metadata cache, presence, and rate-limiting — alongside Postgres, not instead
  of it. This is the standard "SQL for source-of-truth, Redis for ephemeral/hot
  path" split.

No code change is needed today; this section documents the decision so the
boundary is intentional rather than accidental.
