"use client";

import React, { useState } from 'react';
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Disc3, LogIn, LogOut, Menu, X, KeyRound } from 'lucide-react';

export function Appbar() {
  const session = useSession();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black bg-opacity-50 backdrop-blur-lg border-b border-white border-opacity-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 cursor-pointer group">
            <div className="bg-gradient-to-r from-pink-500 to-purple-500 p-2 rounded-lg group-hover:rotate-180 transition-transform duration-500">
              <Disc3 className="w-7 h-7 text-white" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 text-transparent bg-clip-text">
              Muzer
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
          
            
            {session.data?.user ? (
              <div className="flex items-center gap-4">
                <Link
                  href="/join"
                  className="flex items-center gap-2 text-white/90 hover:text-white border border-white/20 hover:border-cyan-400/60 px-5 py-2.5 rounded-full font-semibold transition-all duration-200"
                >
                  <KeyRound className="w-4 h-4" />
                  Join Stream
                </Link>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 flex items-center justify-center text-white font-bold">
                    {session.data.user.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span className="text-white font-medium">{session.data.user.name || 'User'}</span>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="flex items-center gap-2 bg-opacity-10 hover:bg-opacity-20 border border-white border-opacity-20 text-white px-6 py-2.5 rounded-full font-semibold transition-all duration-200"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn()}
                className="flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white px-6 py-2.5 rounded-full font-semibold shadow-lg transform hover:scale-105 transition-all duration-200"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </button>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden text-white p-2 hover:bg-white hover:bg-opacity-10 rounded-lg transition-colors duration-200"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-black bg-opacity-95 backdrop-blur-lg border-t border-white border-opacity-10">
          <div className="px-4 py-6 space-y-4">
           
            
            <div className="pt-4 border-t border-white border-opacity-10">
              {session.data?.user ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 flex items-center justify-center text-white font-bold">
                      {session.data.user.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <span className="text-white font-medium">{session.data.user.name || 'User'}</span>
                  </div>
                  <Link
                    href="/join"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="w-full flex items-center justify-center gap-2 border border-white/20 text-white px-6 py-3 rounded-full font-semibold transition-all duration-200"
                  >
                    <KeyRound className="w-4 h-4" />
                    Join Stream
                  </Link>
                  <button
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="w-full flex items-center justify-center gap-2 bg-white bg-opacity-10 hover:bg-opacity-20 border border-white border-opacity-20 text-white px-6 py-3 rounded-full font-semibold transition-all duration-200"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => signIn()}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white px-6 py-3 rounded-full font-semibold shadow-lg transition-all duration-200"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}