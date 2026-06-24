# Muzer 🎧

A collaborative, real-time music queue. A **host** opens a room, shares two
codes, and their crew joins to drop YouTube tracks and **vote** on what plays
next. The highest-voted track is always "Now Spinning"; the host controls the
deck and can end the room (which wipes all of its data).

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Data model](#data-model)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Core workflows](#core-workflows)
  - [1. Sign in](#1-sign-in)
  - [2. Host: create a room](#2-host-create-a-room)
  - [3. Guest: join with two-code auth](#3-guest-join-with-two-code-auth)
  - [4. Add a track](#4-add-a-track)
  - [5. Vote (one vote per song)](#5-vote-one-vote-per-song)
  - [6. Now Playing / Next Track](#6-now-playing--next-track)
  - [7. End (disable) the room](#7-end-disable-the-room)
- [API reference](#api-reference)
- [Security model](#security-model)
- [Redis (optional)](#redis-optional)
- [Scripts](#scripts)

---

## Features

- **Google sign-in** (NextAuth).
- **Two-code auth** for joining a room: a spoken **join code** + a numeric
  **access code** (second factor).
- **YouTube track queue** with auto-fetched title + thumbnail.
- **Directional voting** — each user gets exactly **one vote per song** (up or
  down); the queue is ordered by net score.
- **Host deck controls** — skip to next track, remove tracks.
- **End session** — host disables the room and every row tied to it
  (tracks, votes, memberships) is permanently deleted.
- **Live-ish updates** via SWR polling (2s).
- **Optional Redis** for rate limiting + metadata caching.

---

## Tech stack

| Layer        | Choice                                              |
|--------------|-----------------------------------------------------|
| Framework    | Next.js 15 (App Router) + React 19                  |
| Language     | TypeScript                                          |
| Auth         | NextAuth v4 (Google provider)                       |
| Database     | PostgreSQL via Prisma                               |
| Cache/limits | Redis via ioredis (optional)                        |
| Styling      | Tailwind CSS v4                                      |
| Validation   | Zod                                                 |

See [`DATABASE.md`](./DATABASE.md) for the SQL-vs-NoSQL analysis and DB setup.

---

## Data model

```
User ─┬─< Session (host)        Session ─┬─< SessionMember >─ User
      ├─< SessionMember                  └─< Stream ─< Upvotes >─ User
      ├─< Stream (host + addedBy)
      └─< Upvotes
```

- **Session** — `code` (unique join code) + `accessCode` (numeric PIN) + `hostId`.
- **SessionMember** — composite-unique `(sessionId, userId)`; created on a
  successful join. Membership = the right to view/add/vote.
- **Stream** — a queued YouTube track, tied to a session.
- **Upvotes** — composite-unique `(userId, streamId)` with a signed `value`
  (`+1` up / `-1` down). The unique constraint is what guarantees **one vote per
  user per song**; net score = sum of values.

---

## Setup

```bash
# 1. Install deps (this repo uses npm — ignore the stray pnpm-lock.yaml)
npm install

# 2. Configure .env (see below)

# 3. Start Postgres (Docker example)
docker run -d --name muzer-postgres \
  -e POSTGRES_USER=muzer -e POSTGRES_PASSWORD=muzer -e POSTGRES_DB=muzer \
  -p 5432:5432 postgres:16

# 4. Apply schema
npx prisma migrate deploy      # or: npx prisma migrate dev
npx prisma generate

# 5. Run
npm run dev    # http://localhost:3000
```

Full DB options (Neon/Supabase/etc.) are in [`DATABASE.md`](./DATABASE.md).

---

## Environment variables

Put these in **`.env`** (Prisma reads `.env` only; Next reads `.env` and
`.env.local`). A template lives in `.env.example`.

| Variable               | Required | Purpose                                              |
|------------------------|----------|------------------------------------------------------|
| `DATABASE_URL`         | ✅       | Postgres connection string                           |
| `NEXTAUTH_SECRET`      | ✅       | Signs the session JWT (auth hangs without it)        |
| `NEXTAUTH_URL`         | ✅ (prod)| Base URL, e.g. `http://localhost:3000`               |
| `GOOGLE_CLIENT_ID`     | ✅       | Google OAuth client                                  |
| `GOOGLE_CLIENT_SECRET` | ✅       | Google OAuth secret                                  |
| `REDIS_URL`            | ⬜ opt   | Enables Redis rate limiting + metadata cache         |

Google OAuth redirect URI: `<NEXTAUTH_URL>/api/auth/callback/google`.

> ⚠️ **Never commit `.env`** — it holds `NEXTAUTH_SECRET` and OAuth secrets.
> Only `.env.example` (no secrets) is tracked.

---

## Core workflows

### 1. Sign in
Every page is gated behind Google sign-in (NextAuth). On first sign-in the user
is upserted into the DB (`signIn` callback in `app/lib/auth.ts`).

### 2. Host: create a room
- Visiting `/dashboard` calls `GET /api/sessions`; if the host has no room it
  calls `POST /api/sessions` to create one.
- **One room per host:** `POST` is idempotent — if a room already exists it's
  returned rather than creating a duplicate.
- The dashboard shows two codes to share: **Join Code** (e.g. `ABC234`) and
  **Access Code** (6-digit PIN).

### 3. Guest: join with two-code auth
- Guest goes to `/join` (or `/session/<code>`), enters **both** codes, and hits
  `POST /api/sessions/join`.
- The server checks the join code **and** the access code. Either failure
  returns the same generic 403 (no enumeration of valid join codes).
- On success a `SessionMember` row is upserted → the guest is now a participant.
- Joining is rate-limited (**10 attempts/min/user**) to blunt PIN brute force.

### 4. Add a track
- Paste a YouTube URL → `POST /api/streams`.
- The URL is parsed to its canonical 11-char video id; the same track can't be
  queued twice in one session.
- Title + thumbnails are fetched (and cached in Redis for 1h if enabled);
  if the lookup fails, the YouTube CDN thumbnail is used as a fallback so the
  track still queues.
- Only participants may add. Rate-limited to **20 adds/min/user**.

### 5. Vote (one vote per song)
- `POST /api/streams/upvote` or `/downvote`.
- Each user has **at most one vote per song**:
  - Upvote sets `+1`; downvote sets `-1`; they flip each other.
  - Clicking the **same** direction again **removes** your vote (toggle off).
- Queue is ordered by **net score** (sum of votes); ties keep insertion order.
- The API returns `myVote` (`1 | -1 | 0`) so the UI highlights your choice.
- Only participants may vote. Rate-limited to **60 votes/min/user**.

### 6. Now Playing / Next Track
- The top-of-queue track is "Now Spinning" (embedded YouTube player).
- **Host only** — "Next Track" calls `DELETE /api/streams` on the current track
  (and its votes, in a transaction), advancing the queue and remounting the
  player. The host can also remove any track from "Up Next".

### 7. End (disable) the room
- **Host only** — the dashboard "End Session" button calls
  `DELETE /api/sessions`.
- Because Muzer runs **one room at a time**, ending it leaves nothing behind:
  votes → streams → memberships → the session itself are all deleted in a single
  transaction.
- The dashboard then spins up a **fresh empty room with new codes**.
- Guests still on the old room get a "Stream ended" message (their queue GET
  now 404s).

---

## API reference

All routes require an authenticated session. Bodies are JSON.

| Method & path                  | Who          | Purpose                                  |
|--------------------------------|--------------|------------------------------------------|
| `GET /api/sessions`            | host         | Get the host's current room + codes      |
| `POST /api/sessions`           | host         | Create room (idempotent — one per host)  |
| `DELETE /api/sessions`         | host         | End room + delete all its data           |
| `POST /api/sessions/join`      | any user     | Join via `{ code, accessCode }`          |
| `GET /api/streams?code=`       | participant  | List queue (with `upvotes`, `myVote`)    |
| `POST /api/streams`            | participant  | Add `{ url, sessionCode }`               |
| `DELETE /api/streams`          | host         | Remove `{ streamId }` from the queue     |
| `POST /api/streams/upvote`     | participant  | Up/toggle vote `{ streamId }`            |
| `POST /api/streams/downvote`   | participant  | Down/toggle vote `{ streamId }`          |

Common status codes: `401` unauthenticated, `403` not a participant / wrong
codes, `404` no such session/stream, `409` duplicate track, `429` rate-limited.

---

## Security model

- **Two-code auth** — join requires both the join code and the numeric access
  code; failures are indistinguishable (no join-code enumeration).
- **CSPRNG codes** — both codes use `crypto.randomInt`, not `Math.random`.
- **Rate limiting** — join/vote/add are throttled per user (Redis-backed, with
  an in-process fallback). Set `REDIS_URL` in production so limits are shared
  across instances.
- **Authorization** — every stream/queue/vote action re-checks participation
  via `isParticipant`; deck/end-room actions are host-only.
- **Secrets** — `.env` (with `NEXTAUTH_SECRET` + OAuth secrets) is gitignored;
  only `.env.example` is tracked.

---

## Redis (optional)

Set `REDIS_URL` to enable. Without it, every helper degrades to a safe no-op /
in-process fallback, so the app runs identically. See `app/lib/redis.ts` and
the "Redis integration" section of [`DATABASE.md`](./DATABASE.md).

Powers: **rate limiting** (join/vote/add) and **YouTube metadata caching**
(1h TTL). Pub/sub realtime + presence remain future work.

---

## Scripts

| Command                   | Does                                 |
|---------------------------|--------------------------------------|
| `npm run dev`             | Dev server (Turbopack)               |
| `npm run build`           | Production build                     |
| `npm start`               | Run the production build             |
| `npm run lint`            | ESLint                               |
| `npm run prisma:migrate`  | `prisma migrate dev`                 |
| `npm run prisma:generate` | Regenerate the Prisma client         |
