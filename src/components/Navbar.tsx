'use client';

import React from 'react';
import { ShieldCheck, ShieldAlert, LogOut, MapPin, Building2, User } from 'lucide-react';

interface NavbarProps {
  userName: string;
  userRole: 'OFFICER' | 'MANAGER';
  assignedPincode: string;
  simulatedHour: number | null;
  onLogout: () => void;
  language: 'en' | 'hi';
}

export function Navbar({
  userName,
  userRole,
  assignedPincode,
  simulatedHour,
  onLogout,
  language,
}: NavbarProps) {
  const isNightLocked = simulatedHour !== null && (simulatedHour >= 19 || simulatedHour < 8);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        
        {/* Brand & Beat Info */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-slate-900 text-base sm:text-lg leading-tight">
                {language === 'hi' ? 'एमएसएमई फील्ड वसूली' : 'MSME Collections'}
              </h1>
              <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                Bengaluru Beat
              </span>
            </div>
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-slate-400" />
              <span>
                {userRole === 'OFFICER'
                  ? `Beat Pincode: ${assignedPincode} (Peenya)`
                  : 'Portfolio Oversight: All Pincodes'}
              </span>
            </p>
          </div>
        </div>

        {/* Center: RBI Compliance Window Banner */}
        <div className="order-3 sm:order-2 w-full sm:w-auto">
          <div
            className={`flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
              !isNightLocked
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-300 text-red-800 shadow-inner'
            }`}
          >
            {!isNightLocked ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>
                  {language === 'hi'
                    ? 'आरबीआई संपर्क विंडो खुली (08:00 - 19:00 IST)'
                    : 'RBI Window Open (08:00 - 19:00 IST)'}
                </span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 text-red-600 animate-pulse" />
                <span className="font-bold">
                  {language === 'hi'
                    ? 'आरबीआई संपर्क निषेध सक्रिय (19:00 के बाद कॉल/विजिट बंद)'
                    : 'RBI Lockout Active (Outbound Contact Blocked after 19:00 IST)'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: User Profile & Logout */}
        <div className="order-2 sm:order-3 flex items-center gap-2 sm:gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-semibold text-slate-800 flex items-center gap-1 justify-end">
              <User className="w-3 h-3 text-slate-400" />
              <span>{userName}</span>
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              {userRole === 'OFFICER' ? 'Field Relationship Officer' : 'Portfolio Collections Manager'}
            </div>
          </div>

          <button
            onClick={onLogout}
            className="touch-target p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition border border-transparent hover:border-red-200"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
}
