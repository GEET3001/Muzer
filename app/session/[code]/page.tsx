"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { Appbar } from "@/app/components/Appbar";
import { ThumbsUp, ThumbsDown, Plus, Disc3, Music2, KeyRound, LogIn } from "lucide-react";

type QueueItem = {
  id: string;
  url: string;
  title: string;
  smallImg: string;
  bigImg: string;
  extractedId: string;
  upvotes: number;
};

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

  // Access gate state (second factor).
  const [accessCode, setAccessCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const { data, error, mutate } = useSWR<{ items: QueueItem[] }>(
    code && auth?.user ? `/api/streams?code=${code}` : null,
    fetcher,
    { refreshInterval: 2000, shouldRetryOnError: false }
  );
  const items = data?.items ?? [];

  // 403 from the queue endpoint means "not a member yet" — show the gate.
  const needsAccess =
    !!auth?.user && error instanceof HttpError && error.status === 403;

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

  const addSong = async () => {
    if (!youtubeUrl.trim() || !auth?.user) return;
    setAdding(true);
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl, sessionCode: code }),
      });
      if (res.ok) {
        setYoutubeUrl("");
        mutate();
      } else {
        const j = await res.json().catch(() => ({}));
        alert(j.message ?? "Failed to add song");
      }
    } finally {
      setAdding(false);
    }
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
        {auth?.user && !needsAccess && (
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
                  onClick={addSong}
                  disabled={adding}
                  className="bg-gradient-to-r from-pink-500 to-purple-600 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg"
                >
                  {adding ? "Adding..." : "Add"}
                </button>
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
                          className="text-green-400 bg-green-500/20 hover:bg-green-500/30 p-1 rounded"
                          aria-label="Upvote"
                        >
                          <ThumbsUp className="w-4 h-4" />
                        </button>
                        <span className="text-white text-sm bg-white/20 px-2 py-1 rounded">
                          {s.upvotes}
                        </span>
                        <button
                          onClick={() => downvote(s.id)}
                          className="text-red-400 bg-red-500/20 hover:bg-red-500/30 p-1 rounded"
                          aria-label="Remove upvote"
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
