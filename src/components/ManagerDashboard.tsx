'use client';

import React, { useState, useMemo } from 'react';
import {
  ShieldAlert,
  Sliders,
  CheckCircle,
  FileSpreadsheet,
  AlertOctagon,
  Search,
} from 'lucide-react';
import { LoanRecord } from './VisitDrawer';
import { OverrideModal } from './OverrideModal';

interface ManagerDashboardProps {
  loans: LoanRecord[];
  onUpdateLoanLocally: (loan: LoanRecord) => void;
  language: 'en' | 'hi';
}

export function ManagerDashboard({
  loans,
  onUpdateLoanLocally,
  language,
}: ManagerDashboardProps) {
  const [selectedPincode, setSelectedPincode] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeOverrideLoan, setActiveOverrideLoan] = useState<LoanRecord | null>(null);

  // Filtered loans
  const filteredLoans = useMemo(() => {
    return loans.filter((loan) => {
      if (selectedPincode !== 'ALL' && loan.pincode !== selectedPincode) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          loan.borrower_name.toLowerCase().includes(q) ||
          loan.owner_name.toLowerCase().includes(q) ||
          loan.account_number.toLowerCase().includes(q) ||
          loan.business_type.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [loans, selectedPincode, searchQuery]);

  // Uncertain / Escalated accounts queue
  const uncertainAccounts = useMemo(() => {
    return filteredLoans.filter((l) => l.ai_confidence !== 'HIGH');
  }, [filteredLoans]);

  // KPI Calculations
  const kpis = useMemo(() => {
    const totalExposure = loans.reduce((acc, l) => acc + l.outstanding_paise, 0);
    const uncertainCount = loans.filter((l) => l.ai_confidence !== 'HIGH').length;
    return {
      totalExposureRupees: Math.round(totalExposure / 100),
      collectedTodayRupees: 15000, // from seed data
      brokenPtpCount: 6,
      uncertainCount,
    };
  }, [loans]);

  // Simulated Audit Feed
  const recentAuditLogs = [
    {
      id: 'audit-1',
      idempotency_key: 'seed-log-001',
      officer: 'Ramesh Kumar (Peenya Beat)',
      borrower: 'Peenya CNC Precision Works',
      outcome: 'PTP (₹42,000 promised)',
      deviceTime: '10:45 AM IST',
      serverTime: '10:45 AM IST',
      syncLag: 'Instant (0s)',
      gps: '13.0285° N, 77.5197° E (±8.5m)',
      idempotencyStatus: 'Verified (Unique)',
    },
    {
      id: 'audit-2',
      idempotency_key: 'seed-log-002',
      officer: 'Ramesh Kumar (Peenya Beat)',
      borrower: 'Balaji Packaging Solutions',
      outcome: 'DISPUTE RAISED',
      deviceTime: '11:15 AM IST',
      serverTime: '11:15 AM IST',
      syncLag: 'Instant (0s)',
      gps: '13.0312° N, 77.5142° E (±11.2m)',
      idempotencyStatus: 'Verified (Unique)',
    },
    {
      id: 'audit-3',
      idempotency_key: 'seed-log-004',
      officer: 'Ramesh Kumar (APMC Beat)',
      borrower: 'Sri Lakshmi Kirana Wholesale',
      outcome: 'PAID (₹15,000 collected)',
      deviceTime: '02:30 PM IST',
      serverTime: '02:30 PM IST',
      syncLag: 'Instant (0s)',
      gps: '13.0189° N, 77.5452° E (±6.2m)',
      idempotencyStatus: 'Verified (Unique)',
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-3 sm:px-4 pb-28 pt-4">
      
      {/* Portfolio Manager Header */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              Management Portal
            </span>
            <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full">
              Full Portfolio View
            </span>
          </div>
          <h2 className="text-xl font-bold mt-1">
            {language === 'hi' ? 'पोर्टफोलियो संग्रह एवं एआई निगरानी' : 'Portfolio Collections & AI Governance'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manager: Priya Nair &bull; Bengaluru Cluster (Peenya, Yeshwanthpur, Chickpet)
          </p>
        </div>

        {/* Pincode Scope Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-xl border border-slate-700">
          {[
            { id: 'ALL', label: 'All Pincodes' },
            { id: '560058', label: '560058 Peenya' },
            { id: '560022', label: '560022 Yeshwanthpur' },
            { id: '560053', label: '560053 Chickpet' },
          ].map((pin) => (
            <button
              key={pin.id}
              onClick={() => setSelectedPincode(pin.id)}
              className={`touch-target px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                selectedPincode === pin.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {pin.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Collectable Exposure</span>
            <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">₹</span>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900">
            ₹{(kpis.totalExposureRupees / 100000).toFixed(2)} Lakhs
          </p>
          <span className="text-[11px] text-slate-400 block font-medium">Across {loans.length} active loans</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Collected Today</span>
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-emerald-600">
            ₹{kpis.collectedTodayRupees.toLocaleString('en-IN')}
          </p>
          <span className="text-[11px] text-emerald-700 font-medium">Real-time receipts</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Broken PTPs (30d)</span>
            <AlertOctagon className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-rose-600">
            {kpis.brokenPtpCount}
          </p>
          <span className="text-[11px] text-rose-700 font-medium">2x prioritisation penalty</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-300 shadow-sm space-y-1 bg-amber-50/40">
          <div className="flex items-center justify-between text-xs text-amber-900 font-semibold">
            <span>AI Uncertainty &amp; Disputes</span>
            <ShieldAlert className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-amber-900">
            {kpis.uncertainCount}
          </p>
          <span className="text-[11px] text-amber-800 font-medium">Human review required</span>
        </div>
      </div>

      {/* SECTION 1: AI Uncertainty & Escalation Queue */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-base">
                AI Uncertainty &amp; Dispute Escalation Queue
              </h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                {uncertainAccounts.length} Pending Audit
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Automated routing frozen until reviewer override per model governance protocol.
            </p>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter queue..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {uncertainAccounts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Zero accounts in uncertain or dispute hold status for selected filter. All AI signals high confidence.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Borrower &amp; Account</th>
                  <th className="p-3">DPD</th>
                  <th className="p-3">Exposure</th>
                  <th className="p-3">AI Flag</th>
                  <th className="p-3">Uncertainty Reason &amp; Signal Diagnosis</th>
                  <th className="p-3 text-right">Reviewer Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uncertainAccounts.map((loan) => (
                  <tr key={loan.id} className="hover:bg-slate-50/80 transition">
                    <td className="p-3">
                      <strong className="text-slate-900 block">{loan.borrower_name}</strong>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {loan.account_number} &bull; Pin: {loan.pincode}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-rose-600">{loan.dpd} DPD</td>
                    <td className="p-3 font-semibold text-slate-900">
                      ₹{(loan.outstanding_paise / 100).toLocaleString('en-IN')}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          loan.ai_confidence === 'DISPUTE_HOLD'
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {loan.ai_confidence}
                      </span>
                    </td>
                    <td className="p-3 max-w-sm text-slate-700 leading-snug">
                      {loan.ai_uncertainty_reason || 'Conflicting payment vs delinquency signal.'}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => setActiveOverrideLoan(loan)}
                        className="touch-target px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-sm transition inline-flex items-center gap-1"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>Override AI</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 2: Field Sync & Compliance Audit Log */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-base">
              Field Sync &amp; Compliance Audit Log
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Immutable ledger of officer visit logs, GPS geotag accuracy, and sync timestamps.
            </p>
          </div>

          <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Audit Feed
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3">Officer &amp; Beat</th>
                <th className="p-3">Account &amp; Outcome</th>
                <th className="p-3">Device Timestamp</th>
                <th className="p-3">Server Sync</th>
                <th className="p-3">GPS Accuracy</th>
                <th className="p-3">Idempotency Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentAuditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition">
                  <td className="p-3 font-semibold text-slate-900">{log.officer}</td>
                  <td className="p-3">
                    <strong className="text-slate-800 block">{log.borrower}</strong>
                    <span className="text-[11px] text-blue-600 font-medium">{log.outcome}</span>
                  </td>
                  <td className="p-3 text-slate-600">{log.deviceTime}</td>
                  <td className="p-3">
                    <span className="text-emerald-700 font-medium">{log.serverTime}</span>
                    <span className="text-[10px] text-slate-400 block font-mono">Lag: {log.syncLag}</span>
                  </td>
                  <td className="p-3 font-mono text-slate-700">{log.gps}</td>
                  <td className="p-3">
                    <span className="bg-slate-100 text-slate-700 font-mono text-[10px] px-2 py-0.5 rounded border border-slate-200">
                      {log.idempotency_key}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Override Modal */}
      <OverrideModal
        loan={activeOverrideLoan}
        onClose={() => setActiveOverrideLoan(null)}
        userRole="MANAGER"
        onOverrideSaved={(updatedLoan) => {
          onUpdateLoanLocally(updatedLoan);
        }}
      />

    </div>
  );
}
