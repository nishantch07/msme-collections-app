'use client';

import React from 'react';
import { Wifi, WifiOff, Sun, Moon, UserCheck, RefreshCw, Languages } from 'lucide-react';

interface DemoToolbarProps {
  currentRole: 'OFFICER' | 'MANAGER';
  onRoleSwitch: (role: 'OFFICER' | 'MANAGER') => void;
  isOnline: boolean;
  onToggleOnline: () => void;
  pendingSyncCount: number;
  onFlushSync: () => void;
  simulatedHour: number | null;
  onToggleRbiClock: () => void;
  language: 'en' | 'hi';
  onToggleLanguage: () => void;
  isFlushing?: boolean;
}

export function DemoToolbar({
  currentRole,
  onRoleSwitch,
  isOnline,
  onToggleOnline,
  pendingSyncCount,
  onFlushSync,
  simulatedHour,
  onToggleRbiClock,
  language,
  onToggleLanguage,
  isFlushing = false,
}: DemoToolbarProps) {
  const isNightLocked = simulatedHour !== null && (simulatedHour >= 19 || simulatedHour < 8);

  return (
    <aside aria-label="Reviewer Demo Control Bar" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-4xl px-3 pointer-events-none">
      <div className="bg-slate-900/95 text-white border border-slate-700 shadow-2xl backdrop-blur-md rounded-2xl p-2.5 flex flex-wrap items-center justify-between gap-2 pointer-events-auto text-xs sm:text-sm">
        
        {/* Left: Reviewer Label & Role Switcher */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden md:inline-block font-bold text-amber-400 uppercase tracking-wider text-[11px] px-2 py-0.5 bg-amber-950/60 border border-amber-600/40 rounded">
            Evaluator Toolbar
          </span>

          {/* Role Switcher */}
          <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
            <button
              onClick={() => onRoleSwitch('OFFICER')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md font-medium transition ${
                currentRole === 'OFFICER'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Officer</span>
            </button>
            <button
              onClick={() => onRoleSwitch('MANAGER')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md font-medium transition ${
                currentRole === 'MANAGER'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Manager</span>
            </button>
          </div>
        </div>

        {/* Center: Network Online/Offline Mode */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={onToggleOnline}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium border transition ${
              isOnline
                ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900'
                : 'bg-amber-950/80 border-amber-500/60 text-amber-300 hover:bg-amber-900 animate-pulse'
            }`}
            title="Toggle between online and simulated offline IndexedDB mode"
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" />}
            <span>{isOnline ? 'Online' : 'Offline Mode'}</span>
            {pendingSyncCount > 0 && (
              <span className="bg-amber-500 text-slate-950 font-bold px-1.5 py-0.2 rounded-full text-[10px]">
                {pendingSyncCount}
              </span>
            )}
          </button>

          {/* Flush Queue Button */}
          {pendingSyncCount > 0 && (
            <button
              onClick={onFlushSync}
              disabled={isFlushing}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium bg-blue-600 hover:bg-blue-500 text-white border border-blue-400 transition"
              title="Flush queued IndexedDB outcomes to SQLite"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFlushing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Flush ({pendingSyncCount})</span>
            </button>
          )}
        </div>

        {/* Right: RBI Clock Simulator & Language */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* RBI Clock Switcher */}
          <button
            onClick={onToggleRbiClock}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium border transition ${
              !isNightLocked
                ? 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'
                : 'bg-red-950/80 border-red-500/70 text-red-300 hover:bg-red-900 animate-pulse'
            }`}
            title="Simulate daytime (14:30 IST) vs nighttime (20:45 IST) RBI contact restriction"
          >
            {!isNightLocked ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>14:30 IST (Open)</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-red-400" />
                <span>20:45 IST (RBI Locked)</span>
              </>
            )}
          </button>

          {/* Language Toggle */}
          <button
            onClick={onToggleLanguage}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-medium transition"
            title="Toggle between English and Hindi"
          >
            <Languages className="w-3.5 h-3.5 text-sky-400" />
            <span>{language === 'en' ? 'EN' : 'हिंदी'}</span>
          </button>
        </div>

      </div>
    </aside>
  );
}
