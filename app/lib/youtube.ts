import youtubesearchapi from "youtube-search-api";

/**
 * Unified YouTube access with a two-tier strategy:
 *   1. Official YouTube Data API v3 when YOUTUBE_API_KEY is set. Reliable from
 *      cloud / data-center IPs — the right choice in production.
 *   2. Falls back to scraping via youtube-search-api when no key is set, or when
 *      an API call fails. Fine for local dev; flaky behind data-center IPs
 *      (which is exactly why the API key exists).
 *
 * Callers keep their own Redis caching / rate-limiting; this module only fetches.
 */

export type SearchItem = { videoId: string; title: string; thumbnail: string };
export type VideoMeta = { title: string; smallImg: string; bigImg: string };

const API_KEY = process.env.YOUTUBE_API_KEY;
const API_BASE = "https://www.googleapis.com/youtube/v3";

function cdnThumb(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

// The Data API returns titles HTML-escaped (&amp;, &#39;, &#x27; ...). Decode the
// common cases so titles render cleanly. &amp; is unescaped last to avoid
// double-decoding sequences like &amp;lt;.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ---- Keyword search -------------------------------------------------------

export async function searchYouTube(q: string, max = 8): Promise<SearchItem[]> {
  if (API_KEY) {
    try {
      return await searchViaApi(q, max);
    } catch (e) {
      console.error("YouTube Data API search failed, falling back to scrape:", e);
    }
  }
  return searchViaScrape(q, max);
}

async function searchViaApi(q: string, max: number): Promise<SearchItem[]> {
  const url =
    `${API_BASE}/search?part=snippet&type=video&maxResults=${max}` +
    `&q=${encodeURIComponent(q)}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search.list ${res.status}`);

  const data = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
    }>;
  };

  return (data.items ?? [])
    .filter((i) => i.id?.videoId)
    .slice(0, max)
    .map((i) => {
      const id = i.id!.videoId as string;
      const thumbs = i.snippet?.thumbnails ?? {};
      return {
        videoId: id,
        title: i.snippet?.title
          ? decodeEntities(i.snippet.title)
          : "Untitled track",
        thumbnail:
          thumbs.high?.url ??
          thumbs.medium?.url ??
          thumbs.default?.url ??
          cdnThumb(id),
      };
    });
}

// Shape of the (untyped) youtube-search-api keyword response we rely on.
type YtKeywordResult = {
  items?: Array<{
    id?: string;
    type?: string;
    title?: string;
    thumbnail?: { thumbnails?: Array<{ url?: string }> };
  }>;
};

async function searchViaScrape(q: string, max: number): Promise<SearchItem[]> {
  const res = (await youtubesearchapi.GetListByKeyword(q, false, max, [
    { type: "video" },
  ])) as YtKeywordResult;

  return (res.items ?? [])
    .filter((i) => i.id && i.type === "video")
    .slice(0, max)
    .map((i) => {
      const id = i.id as string;
      const thumbs = i.thumbnail?.thumbnails ?? [];
      return {
        videoId: id,
        title: i.title ?? "Untitled track",
        thumbnail: thumbs[thumbs.length - 1]?.url ?? cdnThumb(id),
      };
    });
}

// ---- Single-video metadata ------------------------------------------------

export async function fetchVideoMeta(extractedId: string): Promise<VideoMeta> {
  const fallbackThumb = cdnThumb(extractedId);
  const fallback: VideoMeta = {
    title: "Untitled track",
    smallImg: fallbackThumb,
    bigImg: fallbackThumb,
  };

  if (API_KEY) {
    try {
      return await metaViaApi(extractedId, fallback);
    } catch (e) {
      console.error("YouTube Data API details failed, falling back to scrape:", e);
    }
  }

  try {
    return await metaViaScrape(extractedId, fallback);
  } catch {
    // Metadata lookup failed — keep the CDN fallbacks and still queue the song.
    return fallback;
  }
}

async function metaViaApi(id: string, fallback: VideoMeta): Promise<VideoMeta> {
  const url = `${API_BASE}/videos?part=snippet&id=${id}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}`);

  const data = (await res.json()) as {
    items?: Array<{
      snippet?: {
        title?: string;
        thumbnails?: Record<string, { url?: string; width?: number }>;
      };
    }>;
  };

  const snippet = data.items?.[0]?.snippet;
  if (!snippet) return fallback;

  const meta: VideoMeta = { ...fallback };
  if (snippet.title) meta.title = decodeEntities(snippet.title);

  const thumbs = Object.values(snippet.thumbnails ?? {}).filter(
    (t): t is { url: string; width: number } => Boolean(t?.url)
  );
  if (thumbs.length > 0) {
    thumbs.sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    meta.bigImg = thumbs[thumbs.length - 1].url;
    meta.smallImg =
      thumbs.length > 1 ? thumbs[thumbs.length - 2].url : meta.bigImg;
  }
  return meta;
}

async function metaViaScrape(id: string, fallback: VideoMeta): Promise<VideoMeta> {
  const res = await youtubesearchapi.GetVideoDetails(id);
  const meta: VideoMeta = { ...fallback };
  if (res?.title) meta.title = res.title;

  const thumbnails: { url: string; width: number }[] =
    res?.thumbnail?.thumbnails ?? [];
  if (thumbnails.length > 0) {
    thumbnails.sort((a, b) => a.width - b.width);
    meta.bigImg = thumbnails[thumbnails.length - 1].url ?? fallback.bigImg;
    meta.smallImg =
      thumbnails.length > 1
        ? thumbnails[thumbnails.length - 2].url ?? fallback.smallImg
        : meta.bigImg;
  }
  return meta;
}
