# Muzer 🎧

A collaborative, real-time music queue. A **host** opens a room, shares two
codes, friends join and queue YouTube tracks, everyone **votes**, and the
highest-voted track plays next.

---

## Big picture

```mermaid
flowchart LR
  A([Sign in<br/>Google]) --> B{Host or<br/>Guest?}
  B -->|Host| C[Create room<br/>/dashboard]
  C --> D[Share Join +<br/>Access codes]
  B -->|Guest| E[Enter both codes<br/>/join]
  D -. codes .-> E
  E --> F[Two-code check]
  F --> G[[Queue tracks<br/>and vote]]
  C --> G
  G --> H{Host ends<br/>room?}
  H -->|No| G
  H -->|Yes| I[Wipe all data<br/>+ new codes]
```

---

## Tech stack

```mermaid
flowchart LR
  UI[Next.js 15 + React 19<br/>Tailwind] --> API[Route Handlers<br/>NextAuth + Zod]
  API --> PG[(PostgreSQL<br/>Prisma)]
  API -. optional .-> RD[(Redis<br/>ioredis)]
  API --> YT[YouTube<br/>metadata]
```

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Auth | NextAuth v4 (Google) |
| DB | PostgreSQL + Prisma |
| Cache / limits | Redis via ioredis *(optional)* |
| Validation | Zod |

---

## Data model

```mermaid
erDiagram
  User ||--o{ Session : hosts
  User ||--o{ SessionMember : joins
  User ||--o{ Stream : adds
  User ||--o{ Upvotes : casts
  Session ||--o{ SessionMember : "has members"
  Session ||--o{ Stream : queues
  Stream ||--o{ Upvotes : receives

  Session {
    string code "unique join code"
    string accessCode "numeric PIN"
    string hostId
  }
  Stream {
    string extractedId "youtube id"
    string title
    string sessionId
  }
  Upvotes {
    int value "+1 up / -1 down"
  }
```

> One vote per `(user, stream)` is enforced by a composite unique on `Upvotes`;
> net score = sum of `value`.

---

## Workflows

### 🔑 Join — two-code auth

```mermaid
sequenceDiagram
  participant G as Guest
  participant S as Server
  participant DB as Postgres
  G->>S: POST /join {code, accessCode}
  S->>S: rate limit (10/min)
  S->>DB: find session by code
  alt code AND accessCode match
    S->>DB: upsert SessionMember
    S-->>G: 200 joined
  else either wrong
    S-->>G: 403 generic error
  end
```

### ➕ Add a track

```mermaid
flowchart TD
  A[Paste YouTube URL] --> B[Extract 11-char id]
  B -->|invalid| X[400]
  B -->|valid| C{Participant?}
  C -->|no| Y[403]
  C -->|yes| D{Already in queue?}
  D -->|yes| Z[409 duplicate]
  D -->|no| E[Fetch metadata<br/>Redis cache 1h]
  E --> F[Create Stream] --> G[Shows in queue]
```

### 👍👎 Vote — one per song, toggleable

```mermaid
stateDiagram-v2
  [*] --> NoVote
  NoVote --> Up: ▲
  NoVote --> Down: ▼
  Up --> NoVote: ▲ (toggle off)
  Down --> NoVote: ▼ (toggle off)
  Up --> Down: ▼
  Down --> Up: ▲
```

### 🎛️ Now playing / next

```mermaid
flowchart LR
  Q[Queue sorted<br/>by net score] --> N[Top = Now Spinning]
  N --> H{Host: Next Track}
  H -->|DELETE stream + votes| Q
```

### ⏹️ End session — wipe everything

```mermaid
flowchart LR
  A[Host: End Session] --> B[DELETE /api/sessions]
  B --> C[txn: votes → streams<br/>→ members → session]
  C --> D[Fresh room<br/>+ new codes]
  C -. queue 404 .-> E[Guests: 'Stream ended']
```

---

## API

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/sessions` | host | Current room + codes |
| `POST /api/sessions` | host | Create room *(idempotent)* |
| `DELETE /api/sessions` | host | End room + delete its data |
| `POST /api/sessions/join` | user | Join `{ code, accessCode }` |
| `GET /api/streams?code=` | member | Queue (`upvotes`, `myVote`) |
| `GET /api/streams/events?code=` | member | SSE stream of queue-changed events |
| `GET /api/streams/search?code=&q=` | member | YouTube search results |
| `POST /api/streams` | member | Add `{ url, sessionCode }` |
| `DELETE /api/streams` | host | Remove `{ streamId }` |
| `POST /api/streams/upvote` | member | Up / toggle `{ streamId }` |
| `POST /api/streams/downvote` | member | Down / toggle `{ streamId }` |

Status codes: `401` no auth · `403` not a member / wrong codes · `404` gone ·
`409` duplicate · `429` rate-limited.

---

## Setup

```mermaid
flowchart LR
  A[npm install] --> B[set .env] --> C[start Postgres] --> D[prisma migrate deploy] --> E[npm run dev]
```

```bash
npm install
npx prisma migrate deploy
npm run dev          # http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `NEXTAUTH_SECRET` | ✅ | Signs the session JWT |
| `NEXTAUTH_URL` | ✅ (prod) | Base URL |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth |
| `REDIS_URL` | ⬜ | Enables rate limiting + metadata cache |

> ⚠️ `.env` (secrets) is gitignored — only `.env.example` is tracked.
> DB options (Neon / Docker / etc.) are in [`DATABASE.md`](./DATABASE.md).

---

## Security at a glance

```mermaid
flowchart TD
  R[Request] --> A{Signed in?}
  A -->|no| E401[401]
  A -->|yes| L{Rate limit OK?}
  L -->|no| E429[429]
  L -->|yes| P{Participant /<br/>host?}
  P -->|no| E403[403]
  P -->|yes| OK[Proceed]
```

- Two-code join · CSPRNG codes (`crypto.randomInt`) · per-user rate limits
  (Redis + in-proc fallback) · host-only deck/end controls.

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Run production build |
| `npm run lint` | ESLint |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:generate` | Regenerate Prisma client |
