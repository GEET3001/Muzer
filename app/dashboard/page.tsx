"use client";

import { useEffect, useMemo, useState } from "react";
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
};

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

  // Redirect if unauthenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

  // Load the host's existing room (with both codes) or create one. Reusing the
  // server as the source of truth avoids the cross-account localStorage bug.
  useEffect(() => {
    if (status !== "authenticated") return;

    let cancelled = false;
    const init = async () => {
      let res = await fetch("/api/sessions");
      let json = res.ok ? await res.json() : null;
      if (!json?.code) {
        res = await fetch("/api/sessions", { method: "POST" });
        json = res.ok ? await res.json() : null;
      }
      if (json?.code && !cancelled) {
        setSessionCode(json.code);
        setAccessCode(json.accessCode);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [status]);

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
    { refreshInterval: 2000 }
  );

  const sortedQueue = useMemo<QueueItem[]>(() => data?.items ?? [], [data]);

  const addSong = async () => {
    if (!youtubeUrl.trim() || !sessionCode || !auth?.user) return;
    setLoading(true);
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl, sessionCode }),
      });
      if (res.ok) {
        setYoutubeUrl("");
        mutate();
      } else {
        const j = await res.json().catch(() => ({}));
        alert(j.message ?? "Failed to add song");
      }
    } finally {
      setLoading(false);
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
                    onClick={addSong}
                    disabled={loading || !auth?.user}
                    className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white px-6 sm:px-8 py-3 rounded-lg font-semibold shadow-lg transition-all duration-200 text-sm sm:text-base w-full sm:w-auto"
                  >
                    {loading ? "Adding..." : auth?.user ? "Add to Queue" : "Sign in to add"}
                  </button>
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
                                className="bg-green-500 bg-opacity-20 hover:bg-opacity-40 text-green-400 p-1 rounded transition-all flex-shrink-0"
                                aria-label="Upvote"
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
                                className="bg-red-500 bg-opacity-20 hover:bg-opacity-40 text-red-400 p-1 rounded transition-all flex-shrink-0"
                                aria-label="Remove upvote"
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
