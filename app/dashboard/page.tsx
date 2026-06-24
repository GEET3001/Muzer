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
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-900 to-rose-900">
      <Appbar />

      <div className="relative pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl md:text-5xl font-bold text-white">
                  <span className="bg-gradient-to-r from-pink-400 to-purple-400 text-transparent bg-clip-text">
                    The Decks
                  </span>
                </h1>
                {/* Live equalizer */}
                <div className="flex items-end gap-0.5 h-8" aria-hidden="true">
                  {[0.4, 0.9, 0.6, 1, 0.5].map((h, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-full bg-gradient-to-t from-cyan-400 to-pink-400 animate-eq"
                      style={{ height: `${h * 100}%`, animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              </div>
              <p className="text-purple-200 text-lg mt-1">
                Share both codes with your crew to let them join.
              </p>
            </div>

            {/* Two-code credentials: join code + access code */}
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <button
                onClick={() => sessionCode && copyCode(sessionCode, "code")}
                disabled={!sessionCode}
                className="group flex items-center justify-between gap-4 bg-black/40 border border-white/15 hover:border-pink-500/60 rounded-2xl px-5 py-3 transition-all disabled:opacity-50 min-w-[170px]"
                title="Copy join code"
              >
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-widest text-purple-300">
                    Join Code
                  </div>
                  <div className="font-mono font-bold text-white text-2xl tracking-[0.2em]">
                    {sessionCode ?? "······"}
                  </div>
                </div>
                {copied === "code" ? (
                  <Check className="w-5 h-5 text-green-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-5 h-5 text-purple-300 group-hover:text-white flex-shrink-0" />
                )}
              </button>

              <button
                onClick={() => accessCode && copyCode(accessCode, "access")}
                disabled={!accessCode}
                className="group flex items-center justify-between gap-4 bg-black/40 border border-white/15 hover:border-cyan-500/60 rounded-2xl px-5 py-3 transition-all disabled:opacity-50 min-w-[170px]"
                title="Copy access code"
              >
                <div className="text-left">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-cyan-300">
                    <KeyRound className="w-3 h-3" /> Access Code
                  </div>
                  <div className="font-mono font-bold text-white text-2xl tracking-[0.2em]">
                    {accessCode ?? "······"}
                  </div>
                </div>
                {copied === "access" ? (
                  <Check className="w-5 h-5 text-green-400 flex-shrink-0" />
                ) : (
                  <Copy className="w-5 h-5 text-purple-300 group-hover:text-white flex-shrink-0" />
                )}
              </button>

              <button
                onClick={endSession}
                disabled={!sessionCode || ending}
                className="group flex items-center justify-center gap-2 bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/40 hover:border-rose-400 text-rose-200 hover:text-white rounded-2xl px-5 py-3 transition-all disabled:opacity-50"
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
              <div className="bg-black bg-opacity-40 backdrop-blur-xl rounded-3xl p-6 border border-white border-opacity-10 shadow-2xl">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <Disc3
                      className={`w-6 h-6 text-pink-400 ${currentVideoId ? "animate-vinyl" : ""}`}
                    />
                    <h2 className="text-2xl font-bold text-white">Now Spinning</h2>
                  </div>
                  {currentVideoId && (
                    <button
                      onClick={playNext}
                      className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white px-4 py-2 rounded-full text-sm font-semibold transition-all"
                      title="Host: drop the current track and spin the next"
                    >
                      <SkipForward className="w-4 h-4" />
                      Next Track
                    </button>
                  )}
                </div>

                {currentVideoId ? (
                  <div className="space-y-4">
                    <div className="aspect-video rounded-xl overflow-hidden ring-2 ring-pink-500/30">
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
                          <ThumbsUp className="w-4 h-4 text-pink-400" />
                          <span className="text-white font-bold text-lg">
                            {currentSong.upvotes}
                          </span>
                          <span className="text-xs text-purple-400">upvotes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl bg-gradient-to-br from-purple-800 to-pink-800 flex items-center justify-center">
                    <div className="text-center">
                      <Disc3 className="w-20 h-20 text-white mx-auto mb-4 opacity-50" />
                      <p className="text-white text-xl">The deck is empty — drop a track</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-black bg-opacity-40 backdrop-blur-xl rounded-xl p-4 sm:p-6 border border-white border-opacity-10 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400 flex-shrink-0" />
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Drop a Track</h2>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="Paste YouTube URL here..."
                    className="flex-1 bg-gray-900 bg-opacity-90 border-2 border-purple-500 border-opacity-40 text-white placeholder-purple-400 px-4 py-3 rounded-lg focus:outline-none focus:border-pink-500 transition-all duration-200 text-sm sm:text-base"
                    onKeyDown={(e) => e.key === "Enter" && addSong()}
                  />
                  <button
                    onClick={() => addSong()}
                    disabled={loading || !auth?.user}
                    className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white px-6 sm:px-8 py-3 rounded-lg font-semibold shadow-lg transition-all duration-200 text-sm sm:text-base w-full sm:w-auto"
                  >
                    {loading ? "Adding..." : auth?.user ? "Add to Queue" : "Sign in to add"}
                  </button>
                </div>

                {/* Or search YouTube and pick a result */}
                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="…or search YouTube by name"
                        className="w-full bg-gray-900 bg-opacity-90 border-2 border-cyan-500 border-opacity-30 text-white placeholder-purple-400 pl-9 pr-9 py-3 rounded-lg focus:outline-none focus:border-cyan-500 transition-all text-sm sm:text-base"
                        onKeyDown={(e) => e.key === "Enter" && runSearch()}
                      />
                      {searchQuery && (
                        <button
                          onClick={() => {
                            setSearchQuery("");
                            setSearchResults([]);
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 hover:text-white"
                          aria-label="Clear search"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={runSearch}
                      disabled={searching || !searchQuery.trim()}
                      className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-semibold transition-all text-sm sm:text-base w-full sm:w-auto"
                    >
                      {searching ? "Searching…" : "Search"}
                    </button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                      {searchResults.map((r) => (
                        <div
                          key={r.videoId}
                          className="flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-2 transition-all"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.thumbnail}
                            alt={r.title}
                            className="w-16 h-10 rounded object-cover flex-shrink-0"
                          />
                          <span className="flex-1 min-w-0 text-white text-sm line-clamp-2">
                            {r.title}
                          </span>
                          <button
                            onClick={() => addFromSearch(r.videoId)}
                            disabled={loading}
                            className="flex-shrink-0 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-md text-sm font-semibold"
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
              <div className="bg-black bg-opacity-40 backdrop-blur-xl rounded-3xl p-4 sm:p-6 border border-white border-opacity-10 shadow-2xl sticky top-24">
                <div className="flex items-center gap-3 mb-4">
                  <Music2 className="w-5 h-5 sm:w-6 sm:h-6 text-purple-400 flex-shrink-0" />
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Up Next ({upNext.length})
                  </h2>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {upNext.length === 0 ? (
                    <p className="text-purple-300 text-center py-8">
                      Queue is empty — add the next banger
                    </p>
                  ) : (
                    upNext.map((song, idx) => (
                      <div
                        key={song.id}
                        className="bg-white bg-opacity-10 backdrop-blur-lg rounded-xl p-3 border transition-all duration-200 border-white border-opacity-20 hover:bg-opacity-20"
                      >
                        <div className="flex gap-3">
                          <div className="relative flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={song.smallImg}
                              alt={song.title}
                              className="w-20 h-14 rounded-lg object-cover"
                            />
                            <span className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-bold flex items-center justify-center shadow-lg">
                              {idx + 1}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <h3 className="text-white font-semibold text-sm break-words line-clamp-2">
                              {song.title}
                            </h3>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <button
                                onClick={() => upvote(song.id)}
                                className={`p-1 rounded transition-all flex-shrink-0 ${
                                  song.myVote === 1
                                    ? "bg-green-500 text-white"
                                    : "bg-green-500 bg-opacity-20 hover:bg-opacity-40 text-green-400"
                                }`}
                                aria-label="Upvote"
                                aria-pressed={song.myVote === 1}
                              >
                                <ThumbsUp className="w-4 h-4" />
                              </button>
                              <div className="flex items-center gap-1 bg-white bg-opacity-20 px-2 py-1 rounded-md">
                                <span className="text-sm font-bold text-white">
                                  {song.upvotes}
                                </span>
                              </div>
                              <button
                                onClick={() => downvote(song.id)}
                                className={`p-1 rounded transition-all flex-shrink-0 ${
                                  song.myVote === -1
                                    ? "bg-red-500 text-white"
                                    : "bg-red-500 bg-opacity-20 hover:bg-opacity-40 text-red-400"
                                }`}
                                aria-label="Downvote"
                                aria-pressed={song.myVote === -1}
                              >
                                <ThumbsDown className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => removeStream(song.id)}
                                className="ml-auto bg-white/10 hover:bg-white/20 text-purple-200 p-1 rounded transition-all flex-shrink-0"
                                aria-label="Remove from queue"
                                title="Host: remove from queue"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
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
