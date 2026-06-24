"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { Appbar } from "@/app/components/Appbar";
import { ThumbsUp, ThumbsDown, Plus, Disc3, Music2, KeyRound, LogIn, Search, X } from "lucide-react";

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

class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new HttpError(r.status);
  return r.json();
};

export default function SessionPage() {
  const { code } = useParams<{ code: string }>();
  const { data: auth, status } = useSession();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Access gate state (second factor).
  const [accessCode, setAccessCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const { data, error, mutate } = useSWR<{ items: QueueItem[] }>(
    code && auth?.user ? `/api/streams?code=${code}` : null,
    fetcher,
    // Real-time push (below) drives updates; slow poll is just a safety net.
    { refreshInterval: 15000, shouldRetryOnError: false }
  );
  const items = data?.items ?? [];

  // 403 from the queue endpoint means "not a member yet" — show the gate.
  const needsAccess =
    !!auth?.user && error instanceof HttpError && error.status === 403;

  // 404 means the room no longer exists — the host ended (disabled) the session.
  const sessionGone =
    !!auth?.user && error instanceof HttpError && error.status === 404;

  // Live updates once joined: refetch when the server pushes a change. Skipped
  // until the user is a member (the SSE endpoint is participant-gated too).
  const joined = !!auth?.user && !needsAccess && !sessionGone;
  useEffect(() => {
    if (!code || !joined) return;
    const es = new EventSource(`/api/streams/events?code=${code}`);
    es.onmessage = () => mutate();
    return () => es.close();
  }, [code, joined, mutate]);

  const submitAccess = async () => {
    setJoinError(null);
    if (!accessCode.trim()) {
      setJoinError("Enter the access code.");
      return;
    }
    setJoining(true);
    try {
      const res = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, accessCode: accessCode.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        mutate();
      } else {
        setJoinError(json.error ?? "Could not join this stream.");
      }
    } finally {
      setJoining(false);
    }
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

  const addSong = async (urlArg?: string) => {
    const url = (urlArg ?? youtubeUrl).trim();
    if (!url || !auth?.user) return;
    setAdding(true);
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, sessionCode: code }),
      });
      if (res.ok) {
        if (!urlArg) setYoutubeUrl("");
        mutate();
      } else {
        const j = await res.json().catch(() => ({}));
        alert(j.message ?? "Failed to add song");
      }
    } finally {
      setAdding(false);
    }
  };

  // In-app YouTube search so users can pick a track instead of pasting a URL.
  const runSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/streams/search?code=${code}&q=${encodeURIComponent(q)}`
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-900 to-rose-900">
      <Appbar />
      <div className="max-w-4xl mx-auto pt-28 px-4 pb-10">
        <div className="flex items-center gap-3 mb-6">
          <Disc3 className="w-8 h-8 text-pink-400 animate-vinyl" />
          <h1 className="text-white text-3xl font-bold">
            Stream{" "}
            <span className="font-mono tracking-widest bg-gradient-to-r from-pink-400 to-purple-400 text-transparent bg-clip-text">
              {code}
            </span>
          </h1>
        </div>

        {/* Not signed in */}
        {status !== "loading" && !auth?.user && (
          <div className="bg-black/40 border border-white/10 rounded-2xl p-6 text-center">
            <p className="text-purple-200 mb-4">Sign in to join this stream.</p>
            <button
              onClick={() => signIn()}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2 rounded-lg"
            >
              <LogIn className="w-4 h-4" /> Sign in
            </button>
          </div>
        )}

        {/* Host ended the room — everything was deleted. */}
        {sessionGone && (
          <div className="bg-black/40 border border-white/10 rounded-2xl p-6 max-w-sm mx-auto text-center">
            <Disc3 className="w-10 h-10 text-purple-300 mx-auto mb-3" />
            <h2 className="text-white text-xl font-bold mb-1">Stream ended</h2>
            <p className="text-purple-200 text-sm">
              The host has ended this session. Ask them for a new code to join
              again.
            </p>
          </div>
        )}

        {/* Access gate (second factor) */}
        {needsAccess && (
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6 max-w-sm mx-auto text-center">
            <KeyRound className="w-10 h-10 text-cyan-400 mx-auto mb-3" />
            <h2 className="text-white text-xl font-bold mb-1">Access code required</h2>
            <p className="text-purple-200 text-sm mb-4">
              This stream is locked. Enter the access code from your host to join.
            </p>
            <input
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={6}
              placeholder="······"
              className="w-full bg-gray-900 border-2 border-cyan-500/40 focus:border-cyan-400 text-white text-center text-2xl font-mono tracking-[0.3em] px-4 py-3 rounded-xl focus:outline-none mb-3"
              onKeyDown={(e) => e.key === "Enter" && submitAccess()}
            />
            {joinError && (
              <p className="text-rose-300 text-sm mb-3">{joinError}</p>
            )}
            <button
              onClick={submitAccess}
              disabled={joining}
              className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 disabled:opacity-60 text-white px-5 py-3 rounded-xl font-semibold"
            >
              {joining ? "Joining…" : "Unlock Stream"}
            </button>
          </div>
        )}

        {/* Joined: queue + add */}
        {auth?.user && !needsAccess && !sessionGone && (
          <>
            <div className="bg-black/40 border border-white/10 rounded-2xl p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="w-5 h-5 text-cyan-400" />
                <span className="text-white font-semibold">Drop a Track</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="Paste YouTube URL"
                  className="flex-1 bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-purple-400 focus:outline-none focus:border-pink-500"
                  onKeyDown={(e) => e.key === "Enter" && addSong()}
                />
                <button
                  onClick={() => addSong()}
                  disabled={adding}
                  className="bg-gradient-to-r from-pink-500 to-purple-600 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg"
                >
                  {adding ? "Adding..." : "Add"}
                </button>
              </div>

              {/* Or search YouTube and pick a result */}
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="…or search YouTube by name"
                      className="w-full bg-gray-900 border border-cyan-500/30 rounded-lg pl-9 pr-9 py-2 text-white placeholder-purple-400 focus:outline-none focus:border-cyan-500"
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
                    className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold"
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
                    {searchResults.map((r) => (
                      <div
                        key={r.videoId}
                        className="flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-2"
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
                          disabled={adding}
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

            <div className="space-y-3">
              {items.length === 0 ? (
                <div className="text-purple-200 flex items-center gap-2">
                  <Music2 className="w-5 h-5" /> No tracks yet — be the first to drop one
                </div>
              ) : (
                items.map((s, idx) => (
                  <div
                    key={s.id}
                    className="bg-white/10 border border-white/10 rounded-xl p-3 flex gap-3"
                  >
                    <div className="relative flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.smallImg}
                        alt={s.title}
                        className="w-20 h-14 rounded object-cover"
                      />
                      <span className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-bold flex items-center justify-center shadow-lg">
                        {idx + 1}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-semibold line-clamp-2">{s.title}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => upvote(s.id)}
                          className={`p-1 rounded transition-all ${
                            s.myVote === 1
                              ? "bg-green-500 text-white"
                              : "text-green-400 bg-green-500/20 hover:bg-green-500/30"
                          }`}
                          aria-label="Upvote"
                          aria-pressed={s.myVote === 1}
                        >
                          <ThumbsUp className="w-4 h-4" />
                        </button>
                        <span className="text-white text-sm bg-white/20 px-2 py-1 rounded">
                          {s.upvotes}
                        </span>
                        <button
                          onClick={() => downvote(s.id)}
                          className={`p-1 rounded transition-all ${
                            s.myVote === -1
                              ? "bg-red-500 text-white"
                              : "text-red-400 bg-red-500/20 hover:bg-red-500/30"
                          }`}
                          aria-label="Downvote"
                          aria-pressed={s.myVote === -1}
                        >
                          <ThumbsDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
