# Muzer

Collaborative music streaming: host a session, share a link, friends add songs and vote. The most upvoted track plays next — everyone's the DJ.

## Features
- Google sign-in via NextAuth
- **Two-code join (2-factor):** every room has a public **Join Code** and a secret **Access Code**. Guests must enter *both* on the Join screen (`/join`) — there is no open share link. Access is enforced server-side: only the host or members who passed both codes can view, add, or vote.
- Add YouTube songs by URL (any URL shape: `watch?v=`, `youtu.be/`, `embed/`); auto title/thumbnail with a CDN fallback
- Live queue updates via polling (SWR)
- Upvote/downvote to reorder the queue dynamically
- Host deck controls: skip to the next track and remove tracks from the queue

## Joining a stream
1. The host opens the dashboard — it shows the **Join Code** and **Access Code**.
2. The host shares both codes with the crew (the access code over a separate channel).
3. Guests go to **Join Stream** (`/join`), enter both codes, and land in the room.

## Tech
- Next.js (App Router)
- Prisma (PostgreSQL)
- NextAuth (Google)
- SWR

## Getting started

1) Install dependencies
```bash
pnpm install
```

2) Configure environment
Create `.env.local` in the project root with these keys (values are yours to fill in):
```bash
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=
```

3) Prisma
```bash
npx prisma generate
npx prisma migrate dev --name init
```
> Note: the `Session` model has an `accessCode` column for two-code auth. After pulling these changes run `npx prisma migrate dev` again to apply it.

4) Run
```bash
pnpm dev
```
Open http://localhost:3000

## Scripts
- `pnpm dev` – start dev server
- `pnpm build` – build
- `pnpm start` – start production server (after build)
- `pnpm prisma:generate` – Prisma client generate
- `pnpm prisma:migrate` – Run pending migrations in dev

## Deployment
Provide the same env vars in your hosting platform:
- DATABASE_URL
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- NEXTAUTH_URL (your production URL)
- NEXTAUTH_SECRET

Run migrations on deploy (depends on platform), or pre-run locally and ship the DB.

## Notes
- Voting is implemented as upvote/remove-upvote to keep the model simple. If you need downvotes, add a `Downvotes` model and sort by (upvotes - downvotes).
- Real-time updates use polling (SWR refreshInterval). You can switch to WebSockets/SSE later.
