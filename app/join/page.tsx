"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { Appbar } from "../components/Appbar";
import { Disc3, KeyRound, LogIn, ArrowRight } from "lucide-react";

export default function JoinPage() {
  const router = useRouter();
  const { data: auth, status } = useSession();
  const [code, setCode] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const join = async () => {
    setError(null);
    if (!code.trim() || !accessCode.trim()) {
      setError("Enter both the join code and the access code.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), accessCode: accessCode.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/session/${json.code ?? code.trim().toUpperCase()}`);
      } else {
        setError(json.error ?? "Could not join this stream.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-900 to-rose-900">
      <Appbar />
      <div className="max-w-md mx-auto pt-36 px-4 pb-10">
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="bg-gradient-to-r from-pink-500 to-purple-500 p-4 rounded-full mb-4 shadow-[0_0_40px_-5px] shadow-pink-500/60">
              <Disc3 className="w-10 h-10 text-white animate-vinyl" />
            </div>
            <h1 className="text-3xl font-bold text-white">Join a Stream</h1>
            <p className="text-purple-200 mt-2">
              Enter the join code and access code your host shared with you.
            </p>
          </div>

          {status !== "authenticated" ? (
            <div className="text-center">
              <p className="text-purple-200 mb-4">Sign in first to join a stream.</p>
              <button
                onClick={() => signIn(undefined, { callbackUrl: "/join" })}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg transition-all"
              >
                <LogIn className="w-5 h-5" /> Sign in
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="block text-xs uppercase tracking-widest text-purple-300 mb-2">
                  Join Code
                </label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="ABC123"
                  autoCapitalize="characters"
                  className="w-full bg-gray-900 border-2 border-purple-500/40 focus:border-pink-500 text-white text-center text-2xl font-mono tracking-[0.3em] px-4 py-3 rounded-xl focus:outline-none transition-all"
                  onKeyDown={(e) => e.key === "Enter" && join()}
                />
              </div>

              <div>
                <label className="flex items-center gap-1 text-xs uppercase tracking-widest text-cyan-300 mb-2">
                  <KeyRound className="w-3 h-3" /> Access Code
                </label>
                <input
                  value={accessCode}
                  onChange={(e) =>
                    setAccessCode(e.target.value.replace(/\D/g, ""))
                  }
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="······"
                  className="w-full bg-gray-900 border-2 border-cyan-500/40 focus:border-cyan-400 text-white text-center text-2xl font-mono tracking-[0.3em] px-4 py-3 rounded-xl focus:outline-none transition-all"
                  onKeyDown={(e) => e.key === "Enter" && join()}
                />
              </div>

              {error && (
                <p className="text-rose-300 text-sm text-center bg-rose-500/10 border border-rose-500/30 rounded-lg py-2 px-3">
                  {error}
                </p>
              )}

              <button
                onClick={join}
                disabled={loading || !auth?.user}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 disabled:opacity-60 text-white px-6 py-3 rounded-xl font-semibold shadow-lg transition-all"
              >
                {loading ? "Joining…" : "Join Stream"}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
