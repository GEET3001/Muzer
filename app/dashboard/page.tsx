"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Share2, Plus, ThumbsUp, ThumbsDown, Play, Music2, Check, Trash2 } from "lucide-react";
import { Appbar } from "../components/Appbar";

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function Dashboard() {
  const router = useRouter();
  const { data: auth, status } = useSession();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  const [sessionCode, setSessionCode] = useState<string | null>(null);

  // Redirect if unauthenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

  // Create a session on mount if none exists in localStorage
  useEffect(() => {
    const init = async () => {
      const existing = localStorage.getItem("muzer_session_code");
      if (existing) {
        setSessionCode(existing);
        return;
      }
      const res = await fetch("/api/sessions", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        localStorage.setItem("muzer_session_code", json.code);
        setSessionCode(json.code);
      }
    };
    init();
  }, []);

  const { data, isLoading, mutate } = useSWR(
    sessionCode ? `/api/streams?code=${sessionCode}` : null,
    fetcher,
    { refreshInterval: 2000 }
  );

  const sortedQueue = useMemo(() => (data?.items ?? []), [data]);

  const getYoutubeId = (url: string) => {
    const regExp = /^.*(youtu.be\/.|v\/.|u\/\w\/.|embed\/.|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  const addSong = async () => {
    if (!youtubeUrl.trim() || !sessionCode) return;
    if (!auth?.user) return;
    const videoId = getYoutubeId(youtubeUrl);
    if (!videoId) {
      alert("Invalid YouTube URL");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: youtubeUrl, sessionCode })
    });
    setLoading(false);
    if (res.ok) {
      setYoutubeUrl("");
      mutate();
    } else {
      const j = await res.json();
      alert(j.message ?? "Failed to add song");
    }
  };

  const upvote = async (id: string) => {
    await fetch("/api/streams/upvote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id })
    });
    mutate();
  };

  const downvote = async (id: string) => {
    await fetch("/api/streams/downvote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id })
    });
    mutate();
  };

  const shareLink = async () => {
    if (!sessionCode) return;
    const link = `${window.location.origin}/session/${sessionCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentSong = sortedQueue[0];
  const currentVideoId = currentSong ? getYoutubeId(currentSong.url) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-900 to-rose-900">
      <Appbar />

      <div className="relative pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">
                <span className="bg-gradient-to-r from-pink-400 to-purple-400 text-transparent bg-clip-text">
                  Music Stream
                </span>
              </h1>
              <p className="text-purple-200 text-lg">Session: {sessionCode ?? "..."}</p>
            </div>
            <button
              onClick={shareLink}
              className="bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 text-white px-6 py-3 rounded-full font-semibold shadow-lg transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
            >
              {copied ? <Check className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
              {copied ? "Copied!" : "Share Stream"}
            </button>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-black bg-opacity-40 backdrop-blur-xl rounded-3xl p-6 border border-white border-opacity-10 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <Play className="w-6 h-6 text-pink-400" />
                  <h2 className="text-2xl font-bold text-white">Now Playing</h2>
                </div>

                {currentVideoId ? (
                  <div className="space-y-4">
                    <div className="aspect-video rounded-xl overflow-hidden">
                      <iframe
                        key={playerKey}
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
                        <h3 className="text-lg sm:text-xl font-semibold text-white break-words line-clamp-2">{currentSong.title}</h3>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-purple-400">Upvotes:</span>
                          <span className="text-white font-bold text-lg">{currentSong.upvotes}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl bg-gradient-to-br from-purple-800 to-pink-800 flex items-center justify-center">
                    <div className="text-center">
                      <Music2 className="w-20 h-20 text-white mx-auto mb-4 opacity-50" />
                      <p className="text-white text-xl">No songs in queue</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-black bg-opacity-40 backdrop-blur-xl rounded-xl p-4 sm:p-6 border border-white border-opacity-10 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400 flex-shrink-0" />
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Add Song</h2>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="Paste YouTube URL here..."
                    className="flex-1 bg-gray-900 bg-opacity-90 border-2 border-purple-500 border-opacity-40 text-white placeholder-purple-400 px-4 py-3 rounded-lg focus:outline-none focus:border-pink-500 transition-all duration-200 text-sm sm:text-base"
                    onKeyDown={(e) => e.key === 'Enter' && addSong()}
                  />
                  <button
                    onClick={addSong}
                    disabled={loading || !auth?.user}
                    className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white px-6 sm:px-8 py-3 rounded-lg font-semibold shadow-lg transition-all duration-200 text-sm sm:text-base w-full sm:w-auto"
                  >
                    {loading ? "Adding..." : auth?.user ? "Add" : "Sign in to add"}
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="bg-black bg-opacity-40 backdrop-blur-xl rounded-3xl p-4 sm:p-6 border border-white border-opacity-10 shadow-2xl sticky top-24">
                <div className="flex items-center gap-3 mb-4">
                  <Music2 className="w-5 h-5 sm:w-6 sm:h-6 text-purple-400 flex-shrink-0" />
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Queue ({sortedQueue.length})</h2>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {sortedQueue.length === 0 ? (
                    <p className="text-purple-300 text-center py-8">No songs in queue yet</p>
                  ) : (
                    sortedQueue.map((song) => (
                      <div
                        key={song.id}
                        className={`bg-white bg-opacity-10 backdrop-blur-lg rounded-xl p-3 border transition-all duration-200 border-white border-opacity-20 hover:bg-opacity-20`}
                      >
                        <div className="flex gap-3">
                          <img
                            src={song.smallImg}
                            alt={song.title}
                            className="w-20 h-14 rounded-lg object-cover flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <h3 className="text-white font-semibold text-sm break-words line-clamp-2">{song.title}</h3>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <button
                                onClick={() => upvote(song.id)}
                                className="bg-green-500 bg-opacity-20 hover:bg-opacity-40 text-green-400 p-1 rounded transition-all flex-shrink-0"
                                aria-label="Upvote"
                              >
                                <ThumbsUp className="w-4 h-4" />
                              </button>
                              <div className="flex items-center gap-1 bg-white bg-opacity-20 px-2 py-1 rounded-md">
                                <span className={`text-sm font-bold text-white`}>
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

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #ec4899, #8b5cf6);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}