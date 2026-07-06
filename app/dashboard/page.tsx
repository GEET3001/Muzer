"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Plus,
  ThumbsUp,
  ThumbsDown,
  Disc3,
  Music2,
  Check,
  Copy,
  KeyRound,
  Trash2,
  SkipForward,
  Power,
  Search,
  X,
} from "lucide-react";
import { Appbar } from "../components/Appbar";

type QueueItem = {
  id: string;
  url: string;
  title: string;
  smallImg: string;
  bigImg: string;
  extractedId: string;
  upvotes: number;
  myVote: number;
};

type SearchResult = { videoId: string; title: string; thumbnail: string };

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Request failed");
    return res.json();
  });

export default function Dashboard() {
  const router = useRouter();
  const { data: auth, status } = useSession();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [copied, setCopied] = useState<"code" | "access" | null>(null);
  const [loading, setLoading] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Redirect if unauthenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

  // Load the host's existing room (with both codes) or create one. Reusing the
  // server as the source of truth avoids the cross-account localStorage bug.
  const loadOrCreateRoom = useCallback(async (): Promise<boolean> => {
    let res = await fetch("/api/sessions");
    let json = res.ok ? await res.json() : null;
    if (!json?.code) {
      res = await fetch("/api/sessions", { method: "POST" });
      json = res.ok ? await res.json() : null;
    }
    if (json?.code) {
      setSessionCode(json.code);
      setAccessCode(json.accessCode);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    let cancelled = false;
    (async () => {
      const res = await fetch("/api/sessions");
      const json = res.ok ? await res.json() : null;
      if (cancelled) return;
      if (json?.code) {
        setSessionCode(json.code);
        setAccessCode(json.accessCode);
      } else {
        await loadOrCreateRoom();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, loadOrCreateRoom]);

  const copyCode = async (value: string, which: "code" | "access") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy:", value);
    }
  };

  const { data, mutate } = useSWR<{ items: QueueItem[] }>(
    sessionCode ? `/api/streams?code=${sessionCode}` : null,
    fetcher,
    // Real-time push (below) drives updates; this is just a slow safety-net poll.
    { refreshInterval: 15000 }
  );

  const sortedQueue = useMemo<QueueItem[]>(() => data?.items ?? [], [data]);

  // Live updates: refetch the queue the moment the server pushes a change
  // (add / vote / remove / end), instead of hammering the poll every 2s.
  useEffect(() => {
    if (!sessionCode) return;
    const es = new EventSource(`/api/streams/events?code=${sessionCode}`);
    es.onmessage = () => mutate();
    return () => es.close();
  }, [sessionCode, mutate]);

  // Disable the room: deletes the session and ALL its data (tracks, votes,
  // members) server-side, then spins up a fresh empty room with new codes.
  const endSession = async () => {
    const ok = window.confirm(
      "End this session? Everything in it — the queue, votes, and who joined — is permanently deleted. A new room with fresh codes will be created."
    );
    if (!ok) return;
    setEnding(true);
    try {
      const res = await fetch("/api/sessions", { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Failed to end session");
        return;
      }
      // Clear the now-stale queue and credentials, then start a fresh room.
      setSessionCode(null);
      setAccessCode(null);
      await mutate({ items: [] }, { revalidate: false });
      await loadOrCreateRoom();
    } finally {
      setEnding(false);
    }
  };

  const addSong = async (urlArg?: string) => {
    const url = (urlArg ?? youtubeUrl).trim();
    if (!url || !sessionCode || !auth?.user) return;
    setLoading(true);
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, sessionCode }),
      });
      if (res.ok) {
        if (!urlArg) setYoutubeUrl("");
        mutate();
      } else {
        const j = await res.json().catch(() => ({}));
        alert(j.message ?? "Failed to add song");
      }
    } finally {
      setLoading(false);
    }
  };

  // In-app YouTube search so users can pick a track instead of pasting a URL.
  const runSearch = async () => {
    const q = searchQuery.trim();
    if (!q || !sessionCode) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/streams/search?code=${sessionCode}&q=${encodeURIComponent(q)}`
      );
      const j = await res.json().catch(() => ({ items: [] }));
      setSearchResults(res.ok ? j.items ?? [] : []);
    } finally {
      setSearching(false);
    }
  };

  const addFromSearch = async (videoId: string) => {
    await addSong(`https://www.youtube.com/watch?v=${videoId}`);
    setSearchResults([]);
    setSearchQuery("");
  };

  const upvote = async (id: string) => {
    await fetch("/api/streams/upvote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id }),
    });
    mutate();
  };

  const downvote = async (id: string) => {
    await fetch("/api/streams/downvote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id }),
    });
    mutate();
  };

  const removeStream = async (id: string) => {
    await fetch("/api/streams", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id }),
    });
    mutate();
  };

  const playNext = async () => {
    if (!currentSong) return;
    await removeStream(currentSong.id);
    // Force the iframe to remount so the next track starts cleanly.
    setPlayerKey((k) => k + 1);
  };

  const currentSong = sortedQueue[0];
  const currentVideoId = currentSong?.extractedId ?? null;
  const upNext = sortedQueue.slice(1);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#060109] text-white">
      {/* Cohesive neon DJ-booth backdrop: two fixed glows + subtle grid */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-40 h-[36rem] w-[36rem] rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="absolute -bottom-48 -right-32 h-[40rem] w-[40rem] rounded-full bg-fuchsia-600/20 blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:44px_44px]" />
      </div>

      <Appbar />

      <div className="relative pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
                  <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-fuchsia-400 text-transparent bg-clip-text drop-shadow-[0_0_25px_rgba(34,211,238,0.35)]">
                    The Decks
                  </span>
                </h1>
                {/* Live equalizer */}
                <div className="flex items-end gap-0.5 h-8" aria-hidden="true">
                  {[0.4, 0.9, 0.6, 1, 0.5].map((h, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-full bg-gradient-to-t from-cyan-400 to-fuchsia-400 animate-eq"
                      style={{ height: `${h * 100}%`, animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              </div>
              <p className="text-slate-300/80 text-lg mt-1">
                Share both codes with your crew to let them join.
              </p>
            </div>

            {/* Two-code credentials: join code + access code */}
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <button
                onClick={() => sessionCode && copyCode(sessionCode, "code")}
                disabled={!sessionCode}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.06] px-5 py-3 transition-all hover:border-cyan-400/70 hover:bg-cyan-400/[0.1] disabled:opacity-50 min-w-[170px]"
                title="Copy join code"
              >
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-widest text-cyan-300/80">
                    Join Code
                  </div>
                  <div className="font-mono font-bold text-white text-2xl tracking-[0.2em]">
                    {sessionCode ?? "······"}
                  </div>
                </div>
                {copied === "code" ? (
                  <Check className="w-5 h-5 text-cyan-300 flex-shrink-0" />
                ) : (
                  <Copy className="w-5 h-5 text-cyan-300/70 group-hover:text-white flex-shrink-0" />
                )}
              </button>

              <button
                onClick={() => accessCode && copyCode(accessCode, "access")}
                disabled={!accessCode}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/[0.06] px-5 py-3 transition-all hover:border-fuchsia-400/70 hover:bg-fuchsia-400/[0.1] disabled:opacity-50 min-w-[170px]"
                title="Copy access code"
              >
                <div className="text-left">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-fuchsia-300/80">
                    <KeyRound className="w-3 h-3" /> Access Code
                  </div>
                  <div className="font-mono font-bold text-white text-2xl tracking-[0.2em]">
                    {accessCode ?? "······"}
                  </div>
                </div>
                {copied === "access" ? (
                  <Check className="w-5 h-5 text-fuchsia-300 flex-shrink-0" />
                ) : (
                  <Copy className="w-5 h-5 text-fuchsia-300/70 group-hover:text-white flex-shrink-0" />
                )}
              </button>

              <button
                onClick={endSession}
                disabled={!sessionCode || ending}
                className="group flex items-center justify-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-600/15 px-5 py-3 text-rose-200 transition-all hover:border-rose-400 hover:bg-rose-600/30 hover:text-white disabled:opacity-50"
                title="End this session and delete everything in it"
              >
                <Power className="w-5 h-5 flex-shrink-0" />
                <span className="font-semibold">
                  {ending ? "Ending…" : "End Session"}
                </span>
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_0_60px_-25px_rgba(34,211,238,0.5)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <Disc3
                      className={`w-6 h-6 text-cyan-300 ${currentVideoId ? "animate-vinyl" : ""}`}
                    />
                    <h2 className="text-2xl font-bold text-white">
                      Now Spinning
                    </h2>
                    {currentVideoId && (
                      <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
                        Live
                      </span>
                    )}
                  </div>
                  {currentVideoId && (
                    <button
                      onClick={playNext}
                      className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-all hover:border-fuchsia-400/60 hover:bg-fuchsia-500/15"
                      title="Host: drop the current track and spin the next"
                    >
                      <SkipForward className="w-4 h-4" />
                      Next Track
                    </button>
                  )}
                </div>

                {currentVideoId ? (
                  <div className="space-y-4">
                    <div className="aspect-video overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-[0_0_40px_-12px_rgba(217,70,239,0.6)]">
                      <iframe
                        key={`${currentVideoId}-${playerKey}`}
                        width="100%"
                        height="100%"
                        src={`https://www.youtube.com/embed/${currentVideoId}?autoplay=1&enablejsapi=1`}
                        title="YouTube video player"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      ></iframe>
                    </div>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div className="flex-1 min-w-0 pr-4">
                        <h3 className="text-lg sm:text-xl font-semibold text-white break-words line-clamp-2">
                          {currentSong.title}
                        </h3>
                        <div className="flex items-center gap-2 mt-2">
                          <ThumbsUp className="w-4 h-4 text-cyan-300" />
                          <span className="text-white font-bold text-lg">
                            {currentSong.upvotes}
                          </span>
                          <span className="text-xs text-slate-400">upvotes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-900/40 to-fuchsia-900/40 flex items-center justify-center">
                    <div className="text-center">
                      <Disc3 className="w-20 h-20 text-cyan-200/60 mx-auto mb-4" />
                      <p className="text-slate-200 text-xl">The deck is empty — drop a track</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-300 flex-shrink-0" />
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Drop a Track</h2>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="Paste YouTube URL here..."
                    className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder-slate-500 transition-all focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/40 sm:text-base"
                    onKeyDown={(e) => e.key === "Enter" && addSong()}
                  />
                  <button
                    onClick={() => addSong()}
                    disabled={loading || !auth?.user}
                    className="rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/30 transition-all hover:from-cyan-400 hover:to-fuchsia-500 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-700 sm:px-8 sm:text-base w-full sm:w-auto"
                  >
                    {loading ? "Adding..." : auth?.user ? "Add to Queue" : "Sign in to add"}
                  </button>
                </div>

                {/* Or search YouTube and pick a result */}
                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="…or search YouTube by name"
                        className="w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-9 py-3 text-sm text-white placeholder-slate-500 transition-all focus:border-fuchsia-400/60 focus:outline-none focus:ring-1 focus:ring-fuchsia-400/40 sm:text-base"
                        onKeyDown={(e) => e.key === "Enter" && runSearch()}
                      />
                      {searchQuery && (
                        <button
                          onClick={() => {
                            setSearchQuery("");
                            setSearchResults([]);
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                          aria-label="Clear search"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={runSearch}
                      disabled={searching || !searchQuery.trim()}
                      className="rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/15 px-6 py-3 text-sm font-semibold text-fuchsia-100 transition-all hover:bg-fuchsia-500/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:text-base w-full sm:w-auto"
                    >
                      {searching ? "Searching…" : "Search"}
                    </button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                      {searchResults.map((r) => (
                        <div
                          key={r.videoId}
                          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2 transition-all hover:border-cyan-400/40 hover:bg-white/[0.08]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.thumbnail}
                            alt={r.title}
                            className="w-16 h-10 rounded-lg object-cover flex-shrink-0"
                          />
                          <span className="flex-1 min-w-0 text-white text-sm line-clamp-2">
                            {r.title}
                          </span>
                          <button
                            onClick={() => addFromSearch(r.videoId)}
                            disabled={loading}
                            className="flex-shrink-0 rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-600 px-3 py-1.5 text-sm font-semibold text-white transition-all hover:from-cyan-400 hover:to-fuchsia-500 disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-24 rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <Music2 className="w-5 h-5 sm:w-6 sm:h-6 text-fuchsia-300 flex-shrink-0" />
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Up Next{" "}
                    <span className="text-fuchsia-300/80">({upNext.length})</span>
                  </h2>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {upNext.length === 0 ? (
                    <p className="text-slate-400 text-center py-8">
                      Queue is empty — add the next banger
                    </p>
                  ) : (
                    upNext.map((song, idx) => (
                      <div
                        key={song.id}
                        className="rounded-xl border border-white/10 bg-white/[0.04] p-3 transition-all hover:border-cyan-400/40 hover:bg-white/[0.07]"
                      >
                        {/* Title gets its own full-width line so it's always readable */}
                        <div className="flex items-start gap-3">
                          <div className="relative flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={song.smallImg}
                              alt={song.title}
                              className="w-16 h-12 rounded-lg object-cover ring-1 ring-white/10"
                            />
                            <span className="absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-600 text-xs font-bold text-white shadow-lg">
                              {idx + 1}
                            </span>
                          </div>
                          <h3 className="flex-1 min-w-0 text-[0.95rem] font-semibold leading-snug text-white break-words line-clamp-3">
                            {song.title}
                          </h3>
                        </div>

                        {/* Vote controls on their own row, clear of the title */}
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => upvote(song.id)}
                            className={`flex items-center justify-center rounded-lg p-1.5 transition-all ${
                              song.myVote === 1
                                ? "bg-cyan-400 text-black"
                                : "bg-cyan-400/15 text-cyan-300 hover:bg-cyan-400/30"
                            }`}
                            aria-label="Upvote"
                            aria-pressed={song.myVote === 1}
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <div className="min-w-[2.5rem] rounded-lg bg-black/30 px-2 py-1 text-center">
                            <span className="text-sm font-bold text-white">
                              {song.upvotes}
                            </span>
                          </div>
                          <button
                            onClick={() => downvote(song.id)}
                            className={`flex items-center justify-center rounded-lg p-1.5 transition-all ${
                              song.myVote === -1
                                ? "bg-rose-500 text-white"
                                : "bg-rose-500/15 text-rose-300 hover:bg-rose-500/30"
                            }`}
                            aria-label="Downvote"
                            aria-pressed={song.myVote === -1}
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => removeStream(song.id)}
                            className="ml-auto rounded-lg bg-white/5 p-1.5 text-slate-400 transition-all hover:bg-white/15 hover:text-white"
                            aria-label="Remove from queue"
                            title="Host: remove from queue"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
