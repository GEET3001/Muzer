import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prismaClient } from "@/app/lib/db";
import { isParticipant } from "@/app/lib/access";
import { cacheGet, cacheSet, rateLimit } from "@/app/lib/redis";
import { searchYouTube, type SearchItem } from "@/app/lib/youtube";

// In-app YouTube search so users can pick a track instead of pasting a URL.
// Participant-gated (same as the queue), rate-limited, and cached.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ message: "code required" }, { status: 400 });
  }
  if (!q) return NextResponse.json({ items: [] });

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const user = await prismaClient.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const foundSession = await prismaClient.session.findUnique({ where: { code } });
  if (!foundSession) {
    return NextResponse.json({ message: "Invalid session" }, { status: 404 });
  }
  if (!(await isParticipant(user.id, foundSession))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  // Throttle search spam: 30 searches / minute per user.
  if (!(await rateLimit(`search:${user.id}`, 30, 60))) {
    return NextResponse.json(
      { message: "Slow down — too many searches" },
      { status: 429 }
    );
  }

  const cacheKey = `ytsearch:${q.toLowerCase()}`;
  const cached = await cacheGet<SearchItem[]>(cacheKey);
  if (cached) return NextResponse.json({ items: cached });

  try {
    const items = await searchYouTube(q, 8);

    // Results for a given query are stable enough to cache briefly.
    await cacheSet(cacheKey, items, 300);
    return NextResponse.json({ items });
  } catch (e) {
    console.error("GET /api/streams/search failed:", e);
    return NextResponse.json({ message: "Search failed" }, { status: 502 });
  }
}
