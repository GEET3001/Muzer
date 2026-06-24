"use client";

import React, { useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Music, Users, Zap, Sparkles, Disc3, Headphones } from 'lucide-react';
import { Appbar } from './components/Appbar';

export default function LandingPage() {
  const { status } = useSession();
  const router = useRouter();

  // Redirect to dashboard if logged in
  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/dashboard');
    }
  }, [status, router]);

  // Show loading state while checking authentication
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-900 to-rose-900 flex items-center justify-center">
        <div className="text-white text-2xl animate-pulse">Loading the decks…</div>
      </div>
    );
  }

  const startDjing = () => signIn(undefined, { callbackUrl: '/dashboard' });
  const joinStream = () => signIn(undefined, { callbackUrl: '/join' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-pink-900 to-rose-900">
      <Appbar />

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-black opacity-30"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-24">
          <div className="text-center space-y-8">
            <div className="flex justify-center">
              <div className="bg-gradient-to-r from-pink-500 to-purple-500 p-4 rounded-full shadow-[0_0_60px_-5px] shadow-pink-500/60">
                <Disc3 className="w-16 h-16 text-white animate-spin" style={{ animationDuration: '4s' }} />
              </div>
            </div>

            {/* Equalizer bars */}
            <div className="flex justify-center items-end gap-1.5 h-12" aria-hidden="true">
              {[0.2, 0.5, 0.9, 0.4, 0.7, 1, 0.6, 0.35, 0.8, 0.5, 0.95, 0.3].map((h, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-gradient-to-t from-cyan-400 to-pink-400 animate-eq"
                  style={{ height: `${h * 100}%`, animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>

            <h1 className="text-6xl md:text-7xl font-bold text-white leading-tight">
              Your Vibe,
              <span className="block bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 text-transparent bg-clip-text">
                Your Stream
              </span>
            </h1>

            <p className="text-xl md:text-2xl text-purple-200 max-w-3xl mx-auto">
              Let your audience control the music. Create the ultimate collaborative streaming experience where everyone becomes the DJ.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
              <button
                onClick={startDjing}
                className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white px-8 py-4 rounded-full text-lg font-semibold shadow-2xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
              >
                <Zap className="w-5 h-5" />
                Start Streaming
              </button>
              <button
                onClick={joinStream}
                className="bg-white/10 backdrop-blur-lg border-2 border-white/30 text-white px-8 py-4 rounded-full text-lg font-semibold hover:bg-white/20 transition-all duration-200 flex items-center gap-2"
              >
                <Headphones className="w-5 h-5" />
                Join a Stream
              </button>
            </div>
          </div>
        </div>

        {/* Decorative Elements */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse delay-700"></div>
        <div className="absolute bottom-20 left-1/2 w-72 h-72 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse delay-1000"></div>
      </div>

      {/* Features Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            How It Works
          </h2>
          <p className="text-xl text-purple-200">Three simple steps to musical euphoria</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-gradient-to-br from-pink-500 to-purple-600 p-8 rounded-3xl shadow-2xl transform hover:scale-105 transition-all duration-300">
            <div className="bg-white/20 backdrop-blur-lg w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
              <Music className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-4">Create Your Stream</h3>
            <p className="text-purple-100 text-lg">
              Set up your streaming room in seconds. Pick your vibe, set the mood, and get ready to party.
            </p>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-cyan-600 p-8 rounded-3xl shadow-2xl transform hover:scale-105 transition-all duration-300">
            <div className="bg-white/20 backdrop-blur-lg w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
              <Users className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-4">Invite Your Crew</h3>
            <p className="text-purple-100 text-lg">
              Share your stream link. Let your audience join and start adding their favorite tracks to the queue.
            </p>
          </div>

          <div className="bg-gradient-to-br from-cyan-500 to-pink-600 p-8 rounded-3xl shadow-2xl transform hover:scale-105 transition-all duration-300">
            <div className="bg-white/20 backdrop-blur-lg w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-4">Vibe Together</h3>
            <p className="text-purple-100 text-lg">
              Watch as the perfect playlist builds itself. Democracy never sounded so good.
            </p>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-600 rounded-3xl shadow-2xl p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-black opacity-10"></div>
          <div className="relative z-10">
            <Disc3 className="w-16 h-16 text-white mx-auto mb-6 animate-spin" style={{ animationDuration: '4s' }} />
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              Ready to Turn Up?
            </h2>
            <p className="text-xl text-purple-100 mb-8 max-w-2xl mx-auto">
              Join thousands of hosts creating unforgettable musical experiences. Your next epic stream is just a click away.
            </p>
            <button
              onClick={startDjing}
              className="bg-white text-purple-900 px-10 py-5 rounded-full text-xl font-bold shadow-2xl hover:bg-purple-50 transform hover:scale-105 transition-all duration-200"
            >
              Get Started Free
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white border-opacity-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center text-purple-300">
            <p className="text-lg">© 2025 Muzer. Let the music play.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
