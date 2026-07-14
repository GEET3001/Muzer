"use client";

import { useEffect, useRef } from "react";

/**
 * Thin wrapper over the YouTube IFrame Player API. A plain <iframe> embed can't
 * tell us when a video finishes, so we use the real API to fire `onEnded` — that
 * is what drives auto-advance to the next track on the host's deck.
 *
 * The player is created once and reused: when `videoId` changes we call
 * loadVideoById instead of remounting, which is smoother and avoids reloading
 * the API each time.
 */

// Minimal typings for the parts of the IFrame API we touch.
type YTPlayer = {
  loadVideoById: (id: string) => void;
  destroy: () => void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number>;
      events?: { onStateChange?: (e: { data: number }) => void };
    }
  ) => YTPlayer;
  PlayerState: { ENDED: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

// Load the IFrame API script once; resolve when YT is ready. Chains any existing
// onYouTubeIframeAPIReady so we don't clobber another loader.
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export function YouTubePlayer({
  videoId,
  onEnded,
  className,
}: {
  videoId: string;
  onEnded?: () => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  // Keep the latest onEnded in a ref so we never rebuild the player just to
  // capture a new closure.
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || playerRef.current || !hostRef.current || !window.YT)
        return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: {
          onStateChange: (e) => {
            if (e.data === window.YT?.PlayerState.ENDED) onEndedRef.current?.();
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // Created once; videoId changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the track in-place when videoId changes.
  useEffect(() => {
    playerRef.current?.loadVideoById(videoId);
  }, [videoId]);

  return (
    <div className={className}>
      {/* YT replaces this node with its iframe. */}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
