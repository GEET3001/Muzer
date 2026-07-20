"use client";

import { useEffect, useState } from "react";

/** A YouTube search hit as returned by GET /api/streams/search. */
export type SearchResult = { videoId: string; title: string; thumbnail: string };

/**
 * Carries the HTTP status through SWR's error channel. The session page needs
 * it to tell "not a member yet" (403 → show the access gate) apart from "room
 * is gone" (404 → show the ended notice); a bare Error can't express that.
 */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** SWR fetcher: JSON on success, HttpError (with the status) on failure. */
export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
};

/**
 * A single self-clearing status message. Set it and forget it — the message
 * wipes itself after `ms`, and a replacement message restarts the clock rather
 * than inheriting the old one's remaining time.
 */
export function useToast(ms = 4000): [string | null, (msg: string) => void] {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast, ms]);

  return [toast, setToast];
}
