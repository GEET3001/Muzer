# Muzi

Collaborative music streaming: host a session, share a link, friends add songs and vote. The most upvoted track plays next.

## Features
- Google sign-in via NextAuth
- Host session with short join code
- Add YouTube songs by URL (auto title/thumbnail)
- Live queue updates via polling (SWR)
- Upvote to reorder queue dynamically

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
Create `app/.env.local` with:
```bash

```

3) Prisma
```bash
npx prisma generate
npx prisma migrate dev --name init
```

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
