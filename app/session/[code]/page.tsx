"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { Appbar } from "@/app/components/Appbar";
import { ThumbsUp, ThumbsDown, Plus, Music2 } from "lucide-react";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function SessionPage() {
  const { code } = useParams<{ code: string }>();
  const { data: auth } = useSession();
  const [youtubeUrl, setYoutubeUrl] = useState("");

  const { data, mutate } = useSWR(code ? `/api/streams?code=${code}` : null, fetcher, { refreshInterval: 2000 });
  const items = data?.items ?? [];

  const upvote = async (id: string) => {
    await fetch("/api/streams/upvote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ streamId: id }) });
    mutate();
  };

  const downvote = async (id: string) => {
    await fetch("/api/streams/downvote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ streamId: id }) });
    mutate();
  };

  const addSong = async () => {
    if (!youtubeUrl.trim()) return;
    if (!auth?.user) return;
    const res = await fetch("/api/streams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: youtubeUrl, sessionCode: code }) });
    if (res.ok) {
      setYoutubeUrl("");
      mutate();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-900 to-rose-900">
      <Appbar />
      <div className="max-w-4xl mx-auto pt-28 px-4 pb-10">
        <h1 className="text-white text-3xl font-bold mb-4">Join Session: {code}</h1>

        {!auth?.user && (
          <button onClick={() => signIn()} className="mb-6 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2 rounded-lg">Sign in to vote</button>
        )}

        <div className="bg-black/40 border border-white/10 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Plus className="w-5 h-5 text-cyan-400" />
            <span className="text-white font-semibold">Add Song</span>
          </div>
          <div className="flex gap-2">
            <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="Paste YouTube URL" className="flex-1 bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white" />
            <button onClick={addSong} disabled={!auth?.user} className="bg-gradient-to-r from-pink-500 to-purple-600 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg">{auth?.user ? "Add" : "Sign in to add"}</button>
          </div>
        </div>

        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="text-purple-200 flex items-center gap-2"><Music2 className="w-5 h-5" /> No songs yet</div>
          ) : items.map((s: any) => (
            <div key={s.id} className="bg-white/10 border border-white/10 rounded-xl p-3 flex gap-3">
              <img src={s.smallImg} alt={s.title} className="w-20 h-14 rounded object-cover" />
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold truncate">{s.title}</div>
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => upvote(s.id)} className="text-green-400 bg-green-500/20 hover:bg-green-500/30 p-1 rounded"><ThumbsUp className="w-4 h-4" /></button>
                  <span className="text-white text-sm bg-white/20 px-2 py-1 rounded">{s.upvotes}</span>
                  <button onClick={() => downvote(s.id)} className="text-red-400 bg-red-500/20 hover:bg-red-500/30 p-1 rounded"><ThumbsDown className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
