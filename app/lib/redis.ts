import type { Redis as RedisType } from "ioredis";
import { EventEmitter } from "events";

/**
 * Optional Redis layer. Activated only when REDIS_URL is set; otherwise every
 * helper degrades gracefully so the app runs identically without Redis.
 *
 * Used for:
 *  - rate limiting (join / vote / add) — falls back to an in-process counter
 *  - caching slow YouTube metadata lookups
 *
 * The client is created lazily and cached on globalThis so Next.js hot-reload
 * and serverless warm starts don't open a new connection per request.
 */
const globalForRedis = globalThis as unknown as {
  redis?: RedisType | null;
};

function getRedis(): RedisType | null {
  if (globalForRedis.redis !== undefined) return globalForRedis.redis;

  if (!process.env.REDIS_URL) {
    globalForRedis.redis = null;
    return null;
  }

  try {
    // Lazy require so the app builds/runs even if ioredis isn't installed and
    // REDIS_URL is unset.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    const client: RedisType = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    client.on("error", (err: unknown) => {
      console.error("Redis error:", err);
    });
    globalForRedis.redis = client;
    return client;
  } catch (e) {
    console.error("Redis init failed, continuing without it:", e);
    globalForRedis.redis = null;
    return null;
  }
}

// In-process fallback window store: key -> { count, resetAt(ms) }.
const memoryWindows = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed-window rate limit. Returns true if the action is allowed.
 * @param key    unique bucket key (e.g. `join:<userId>`)
 * @param limit  max actions allowed within the window
 * @param windowSec window length in seconds
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const namespaced = `rl:${key}`;
      const count = await redis.incr(namespaced);
      if (count === 1) {
        await redis.expire(namespaced, windowSec);
      }
      return count <= limit;
    } catch (e) {
      console.error("rateLimit redis failed, allowing:", e);
      return true;
    }
  }

  // In-memory fallback (per-instance only; resets on redeploy).
  const now = Date.now();
  const entry = memoryWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/** Cache read. Returns parsed JSON of type T, or null on miss / no Redis. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`cache:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.error("cacheGet failed:", e);
    return null;
  }
}

/** Cache write with TTL (seconds). No-op when Redis is unavailable. */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSec: number
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`cache:${key}`, JSON.stringify(value), "EX", ttlSec);
  } catch (e) {
    console.error("cacheSet failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Real-time pub/sub for queue updates.
// With Redis: publishes across every server instance (the right thing in prod).
// Without Redis: an in-process EventEmitter still delivers events within a
// single server process (fine for dev / single-instance deploys).
// A Redis client in subscribe mode can't run normal commands, so we keep a
// dedicated duplicated connection for subscriptions.
// ---------------------------------------------------------------------------
const QUEUE_CHANNEL_PREFIX = "muzer:session:";
const localBus = new EventEmitter();
localBus.setMaxListeners(0);

let subscriber: RedisType | null | undefined;
const channelRefCounts = new Map<string, number>();

function getSubscriber(): RedisType | null {
  if (subscriber !== undefined) return subscriber;
  const client = getRedis();
  if (!client) {
    subscriber = null;
    return null;
  }
  try {
    const sub = client.duplicate();
    sub.on("message", (channel: string) => localBus.emit(channel));
    sub.on("error", (err: unknown) =>
      console.error("Redis subscriber error:", err)
    );
    subscriber = sub;
    return sub;
  } catch (e) {
    console.error("Redis subscriber init failed:", e);
    subscriber = null;
    return null;
  }
}

/** Notify listeners (this process + other instances via Redis) that a session's
 *  queue changed. Safe to await; never throws. */
export async function publishQueueChanged(code: string): Promise<void> {
  const channel = QUEUE_CHANNEL_PREFIX + code;
  const client = getRedis();
  if (client) {
    try {
      await client.publish(channel, "1");
      return;
    } catch (e) {
      console.error("publishQueueChanged failed, using local bus:", e);
    }
  }
  localBus.emit(channel);
}

/** Subscribe to a session's queue-changed events. Returns an unsubscribe fn. */
export function subscribeQueueChanged(
  code: string,
  cb: () => void
): () => void {
  const channel = QUEUE_CHANNEL_PREFIX + code;
  localBus.on(channel, cb);

  const sub = getSubscriber();
  if (sub) {
    const next = (channelRefCounts.get(channel) ?? 0) + 1;
    channelRefCounts.set(channel, next);
    if (next === 1) {
      sub.subscribe(channel).catch((e) =>
        console.error("redis subscribe failed:", e)
      );
    }
  }

  return () => {
    localBus.off(channel, cb);
    if (sub) {
      const left = (channelRefCounts.get(channel) ?? 1) - 1;
      if (left <= 0) {
        channelRefCounts.delete(channel);
        sub.unsubscribe(channel).catch(() => {});
      } else {
        channelRefCounts.set(channel, left);
      }
    }
  };
}
