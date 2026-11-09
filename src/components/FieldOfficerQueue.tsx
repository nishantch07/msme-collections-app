'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Phone,
  MessageSquareText,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  History,
  FileCheck2,
} from 'lucide-react';
import { LoanRecord, VisitDrawer } from './VisitDrawer';
import { AiReminderModal } from './AiReminderModal';
import { OverrideModal } from './OverrideModal';

interface FieldOfficerQueueProps {
  loans: LoanRecord[];
  isOnline: boolean;
  simulatedHour: number | null;
  language: 'en' | 'hi';
  onRefreshLoans: () => void;
  onUpdateLoanLocally: (loan: LoanRecord) => void;
  onQueueOfflineOutcome: (offlineItem: any) => void;
  officerName: string;
}

export function FieldOfficerQueue({
  loans,
  isOnline,
  simulatedHour,
  language,
  onUpdateLoanLocally,
  onQueueOfflineOutcome,
  officerName,
}: FieldOfficerQueueProps) {
  const [selectedPincode, setSelectedPincode] = useState<string>('560058'); // Default to Peenya beat
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'UNSURE' | 'HIGH_PRIORITY' | 'TODAY_ACTIONED'>('ALL');
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);

  // Modals state
  const [activeVisitLoan, setActiveVisitLoan] = useState<LoanRecord | null>(null);
  const [activeReminderLoan, setActiveReminderLoan] = useState<LoanRecord | null>(null);
  const [activeOverrideLoan, setActiveOverrideLoan] = useState<LoanRecord | null>(null);

  const isNightLocked = simulatedHour !== null && (simulatedHour >= 19 || simulatedHour < 8);

  // Filtered loans list
  const filteredLoans = useMemo(() => {
    return loans.filter((loan) => {
      // Pincode filter
      if (selectedPincode !== 'ALL' && loan.pincode !== selectedPincode) {
        return false;
      }

      // Tab filter
      if (activeTab === 'UNSURE') {
        if (loan.ai_confidence === 'HIGH') return false;
      } else if (activeTab === 'HIGH_PRIORITY') {
        const effScore = loan.manual_override_score ?? loan.priority_score;
        if (effScore < 75) return false;
      }

      // Search keyword filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          loan.borrower_name.toLowerCase().includes(q) ||
          loan.owner_name.toLowerCase().includes(q) ||
          loan.account_number.toLowerCase().includes(q) ||
          loan.business_type.toLowerCase().includes(q) ||
          loan.phone.includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [loans, selectedPincode, activeTab, searchQuery]);

  // Statistics for Beat
  const beatStats = useMemo(() => {
    const totalExposure = loans.reduce((acc, l) => acc + l.outstanding_paise, 0);
    const unsureCount = loans.filter((l) => l.ai_confidence !== 'HIGH').length;
    return {
      count: loans.length,
      totalExposureRupees: Math.round(totalExposure / 100),
      unsureCount,
    };
  }, [loans]);

  const handleCallBorrower = (phone: string, borrowerName: string) => {
    if (isNightLocked) {
      alert(`⚠️ RBI Contact Lockout Active: Outbound calls are legally restricted between 19:00 and 08:00 IST.`);
      return;
    }
    window.location.href = `tel:${phone}`;
  };

  const getScoreBadgeColor = (score: number) => {
    if (score >= 80) return 'bg-rose-600 text-white';
    if (score >= 60) return 'bg-amber-500 text-slate-950 font-black';
    return 'bg-emerald-600 text-white';
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto px-3 sm:px-4 pb-28 pt-4">
      
      {/* Beat Summary Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-blue-950 text-white rounded-2xl p-4 sm:p-5 shadow-lg border border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                {language === 'hi' ? 'फील्ड अधिकारी बीट' : 'Field Beat Queue'}
              </span>
              <span className="text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded-full">
                AI Prioritised
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold mt-0.5">
              {language === 'hi'
                ? `अधिकारी: ${officerName} (पीन्या क्लस्टर)`
                : `Officer: ${officerName} (Bengaluru West Beat)`}
            </h2>
          </div>

          <div className="flex items-center gap-4 text-xs sm:text-sm">
            <div className="bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-700">
              <span className="text-slate-400 block text-[11px]">Accounts in Beat</span>
              <strong className="text-base text-white">{beatStats.count}</strong>
            </div>
            <div className="bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-700">
              <span className="text-slate-400 block text-[11px]">Unsure / Disputes</span>
              <strong className="text-base text-amber-400">{beatStats.unsureCount}</strong>
            </div>
            <div className="bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-700 hidden sm:block">
              <span className="text-slate-400 block text-[11px]">Exposure</span>
              <strong className="text-base text-emerald-400">
                ₹{(beatStats.totalExposureRupees / 100000).toFixed(1)}L
              </strong>
            </div>
          </div>
        </div>

        {/* Pincode Beat Filter Chips */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">Beat Area:</span>
          {[
            { id: '560058', label: '560058 Peenya Industrial' },
            { id: '560022', label: '560022 Yeshwanthpur' },
            { id: '560053', label: '560053 Chickpet Wholesalers' },
            { id: 'ALL', label: 'All Pincodes (Portfolio)' },
          ].map((pin) => (
            <button
              key={pin.id}
              onClick={() => setSelectedPincode(pin.id)}
              className={`touch-target px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                selectedPincode === pin.id
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {pin.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          {[
            { id: 'ALL', labelEn: 'All Accounts', labelHi: 'सभी खाते' },
            { id: 'HIGH_PRIORITY', labelEn: 'Urgent (Score > 75)', labelHi: 'अति-प्राथमिक' },
            { id: 'UNSURE', labelEn: `AI Unsure (${beatStats.unsureCount})`, labelHi: `समीक्षा योग्य (${beatStats.unsureCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`touch-target px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {language === 'hi' ? tab.labelHi : tab.labelEn}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'hi' ? 'नाम या खाता संख्या खोजें...' : 'Search borrower, shop, account...'}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              &times;
            </button>
          )}
        </div>

      </div>

      {/* Empty State */}
      {filteredLoans.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 text-base">No matching loan accounts found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Try adjusting your search keywords or switch the active pincode beat filter above.
          </p>
          <button
            onClick={() => {
              setSelectedPincode('ALL');
              setSearchQuery('');
              setActiveTab('ALL');
            }}
            className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800"
          >
            Reset All Filters
          </button>
        </div>
      )}

      {/* Prioritized Loan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filteredLoans.map((loan, idx) => {
          const effectiveScore = loan.manual_override_score ?? loan.priority_score;
          const isOverridden = loan.manual_override_score !== null && loan.manual_override_score !== undefined;
          const isExpanded = expandedLoanId === loan.id;

          let topBadges: string[] = [];
          try {
            topBadges = JSON.parse(loan.priority_breakdown || '[]');
          } catch {
            topBadges = [`${loan.dpd} DPD`, `₹${(loan.outstanding_paise / 10000000).toFixed(2)}L`];
          }

          const hasUncertainty = loan.ai_confidence !== 'HIGH';

          return (
            <div
              key={loan.id}
              className={`bg-white rounded-2xl border transition-all duration-200 overflow-hidden shadow-sm hover:shadow-md ${
                hasUncertainty
                  ? 'border-amber-400/80 ring-1 ring-amber-300/50'
                  : 'border-slate-200'
              }`}
            >
              {/* Card Header & Rank */}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  
                  {/* Left: Rank, Name, Details */}
                  <div className="flex items-start gap-2.5">
                    <span className="text-xs font-bold text-slate-400 mt-0.5">
                      #{idx + 1}
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-900 text-base leading-tight">
                        {loan.borrower_name}
                      </h3>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">
                        Prop: <strong className="text-slate-700">{loan.owner_name}</strong> &bull; {loan.business_type}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {loan.account_number} &bull; Pin: {loan.pincode}
                      </p>
                    </div>
                  </div>

                  {/* Right: Priority Score Badge */}
                  <div className="text-right shrink-0">
                    <div
                      className={`inline-flex items-center justify-center px-2.5 py-1 rounded-xl text-xs sm:text-sm font-black shadow-sm ${getScoreBadgeColor(
                        effectiveScore
                      )}`}
                      title={`Calculated Score: ${loan.priority_score.toFixed(1)}${
                        isOverridden ? ` (Overridden to ${loan.manual_override_score})` : ''
                      }`}
                    >
                      {effectiveScore.toFixed(1)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
                      {isOverridden ? 'Manual Override' : 'AI Priority'}
                    </div>
                  </div>

                </div>

                {/* Financial Summary Strip */}
                <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-xs border border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Total Overdue</span>
                    <strong className="text-slate-900 font-bold text-xs sm:text-sm">
                      ₹{(loan.outstanding_paise / 100).toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Monthly EMI</span>
                    <strong className="text-slate-800 font-bold">
                      ₹{(loan.emi_amount_paise / 100).toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Delinquency</span>
                    <strong className={`font-black ${loan.dpd >= 60 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {loan.dpd} DPD
                    </strong>
                  </div>
                </div>

                {/* Top 3 Explainability Badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {topBadges.slice(0, 3).map((badge, bIdx) => (
                    <span
                      key={bIdx}
                      className="text-[11px] font-medium px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200"
                    >
                      {badge}
                    </span>
                  ))}
                </div>

                {/* AI Uncertainty / Dispute Hold Banner */}
                {hasUncertainty && (
                  <div className="p-3 bg-amber-50/90 border border-amber-300 rounded-xl space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5 text-xs text-amber-950 font-bold">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span>
                            {loan.ai_confidence === 'DISPUTE_HOLD'
                              ? 'DISPUTE HOLD: Automated Routing Frozen'
                              : 'AI LOW CONFIDENCE: Signal Conflict Detected'}
                          </span>
                          <p className="text-[11px] text-amber-900 font-normal mt-0.5 leading-snug">
                            {loan.ai_uncertainty_reason || 'Discrepancy detected in ledger or visit pattern.'}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveOverrideLoan(loan)}
                        className="touch-target px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg shrink-0 shadow-sm transition"
                      >
                        Override AI
                      </button>
                    </div>

                    {loan.manual_override_reason && (
                      <div className="text-[10px] text-slate-600 bg-white/80 p-1.5 rounded border border-amber-200 font-mono">
                        Audit: {loan.manual_override_reason}
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Action Buttons: 3-Tap Log, AI Reminder, Call, Expand */}
              <div className="bg-slate-50 p-2.5 px-4 border-t border-slate-200 flex items-center justify-between gap-2">
                
                <div className="flex items-center gap-2 flex-1">
                  {/* 3-Tap Log Visit */}
                  <button
                    type="button"
                    onClick={() => setActiveVisitLoan(loan)}
                    className="touch-target flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm shadow-blue-500/20 transition"
                  >
                    <FileCheck2 className="w-4 h-4" />
                    <span>3-Tap Visit</span>
                  </button>

                  {/* AI Reminder */}
                  <button
                    type="button"
                    onClick={() => setActiveReminderLoan(loan)}
                    className="touch-target py-2 px-3 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition"
                    title="Generate compliant reminder draft"
                  >
                    <MessageSquareText className="w-4 h-4 text-emerald-600" />
                    <span className="hidden sm:inline">AI Reminder</span>
                  </button>

                  {/* Call Borrower */}
                  <button
                    type="button"
                    onClick={() => handleCallBorrower(loan.phone, loan.borrower_name)}
                    className={`touch-target p-2.5 rounded-xl border transition ${
                      isNightLocked
                        ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-not-allowed'
                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-800'
                    }`}
                    title={isNightLocked ? 'RBI Lockout Active (Calls restricted)' : `Call ${loan.phone}`}
                  >
                    <Phone className="w-4 h-4 text-blue-600" />
                  </button>
                </div>

                {/* Expand / Collapse Details */}
                <button
                  type="button"
                  onClick={() => setExpandedLoanId(isExpanded ? null : loan.id)}
                  className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
                  title="View history"
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

              </div>

              {/* Collapsible History Section */}
              {isExpanded && (
                <div className="p-4 bg-slate-100/70 border-t border-slate-200 text-xs space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span className="flex items-center gap-1">
                      <History className="w-3.5 h-3.5 text-blue-600" />
                      Visit &amp; Promise History
                    </span>
                    <span className="text-[11px] text-slate-500 font-normal">
                      Last updated: Just now
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1">
                      <div className="flex justify-between font-semibold text-slate-700">
                        <span>Contact Number:</span>
                        <span className="font-mono text-slate-900">{loan.phone}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>GPS Coordinates:</span>
                        <span className="font-mono text-slate-800">
                          {loan.gps_lat.toFixed(4)}&deg; N, {loan.gps_lng.toFixed(4)}&deg; E
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          );
        })}
      </div>

      {/* Modals */}
      <VisitDrawer
        loan={activeVisitLoan}
        onClose={() => setActiveVisitLoan(null)}
        isOnline={isOnline}
        simulatedHour={simulatedHour}
        language={language}
        onOutcomeLogged={(updatedLoan, offlineItem) => {
          if (updatedLoan) {
            onUpdateLoanLocally(updatedLoan);
          } else if (offlineItem) {
            onQueueOfflineOutcome(offlineItem);
          }
        }}
      />

      <AiReminderModal
        loan={activeReminderLoan}
        onClose={() => setActiveReminderLoan(null)}
        officerName={officerName}
        simulatedHour={simulatedHour}
      />

      <OverrideModal
        loan={activeOverrideLoan}
        onClose={() => setActiveOverrideLoan(null)}
        userRole="OFFICER"
        onOverrideSaved={(updatedLoan) => {
          onUpdateLoanLocally(updatedLoan);
        }}
      />

    </div>
  );
}
