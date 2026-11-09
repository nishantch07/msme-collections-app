'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Lock,
  Mail,
  UserCheck,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const performLogin = async (loginEmail: string, loginPass: string) => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPass }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Store basic session user info in localStorage for instant client boot
      localStorage.setItem('msme_user', JSON.stringify(data.user));

      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed. Please check credentials.';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performLogin(email, password);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center px-4 py-8">
      
      {/* Background ambient decorative glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10 space-y-6">
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg shadow-blue-500/30">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            MSME Field Collections
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            AI-Prioritised Delinquency Recovery &bull; RBI Fair Practices Compliant
          </p>
        </div>

        {/* 1-Click Reviewer Quick Access Cards */}
        <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Evaluator 1-Click Fast Logins</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {/* Card 1: Field Officer */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => performLogin('officer@msmelender.in', 'Officer@123')}
              className="touch-target p-3 rounded-xl bg-slate-900/90 hover:bg-slate-900 border border-blue-500/40 hover:border-blue-500 text-left transition flex items-center justify-between group shadow-sm"
            >
              <div>
                <div className="flex items-center gap-1.5 font-bold text-white text-sm">
                  <UserCheck className="w-4 h-4 text-blue-400" />
                  <span>Ramesh Kumar</span>
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/40">
                    Field Officer
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Peenya Beat (560058) &bull; 3-Tap Logging &bull; WhatsApp AI
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-blue-400 group-hover:translate-x-1 transition" />
            </button>

            {/* Card 2: Manager */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => performLogin('manager@msmelender.in', 'Manager@123')}
              className="touch-target p-3 rounded-xl bg-slate-900/90 hover:bg-slate-900 border border-indigo-500/40 hover:border-indigo-500 text-left transition flex items-center justify-between group shadow-sm"
            >
              <div>
                <div className="flex items-center gap-1.5 font-bold text-white text-sm">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>Priya Nair</span>
                  <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/40">
                    Collections Manager
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Portfolio Head &bull; Dispute Escalation Queue &bull; Audit Trail
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-indigo-400 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </div>

        {/* Standard Manual Login Form */}
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">
            Or Sign In With Email
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-600/60 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@msmelender.in"
                  className="touch-target w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="touch-target w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="touch-target w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition shadow-lg shadow-blue-600/30 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <span>{isLoading ? 'Signing In...' : 'Sign In'}</span>
            </button>
          </form>

          <div className="pt-2 text-center text-[11px] text-slate-500">
            Author: <strong className="text-slate-400">Nishant Chhetri</strong> &bull; Isocode Take-Home Assessment
          </div>
        </div>

      </div>
    </div>
  );
}
