'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ShieldAlert,
  Sliders,
  CheckCircle,
  AlertOctagon,
  Search,
  Upload,
} from 'lucide-react';
import { LoanRecord } from './VisitDrawer';
import { OverrideModal } from './OverrideModal';

interface ManagerDashboardProps {
  loans: LoanRecord[];
  onUpdateLoanLocally: (loan: LoanRecord) => void;
  onRefreshLoans: () => void;
  language: 'en' | 'hi';
  hasMoreLoans: boolean;
  isLoadingMoreLoans: boolean;
  totalLoanCount: number;
  totalExposurePaise: number;
  uncertainLoanCount: number;
  onLoadMoreLoans: () => void;
}

interface ManagerMetrics {
  collectedTodayPaise: number;
  rollRate: {
    eligible: number;
    rolled: number;
    rate: number | null;
    byBranch: Array<{ branch: string; eligible: number; rolled: number; rate: number }>;
    latestImport: { filename: string; imported_at: string } | null;
    previousImport: { filename: string; imported_at: string } | null;
  };
  backtest: {
    windowDays: number;
    scoreBands: Array<{ band: string; sampleSize: number; paidCount: number; paymentRate: number | null }>;
    note: string;
  };
  promises: {
    active: number;
    broken: number;
    items: Array<{
      id: string;
      promised_amount_paise: number;
      promise_date: string;
      status: string;
      loan: { borrower_name: string; account_number: string; pincode: string };
    }>;
  };
  recentOutcomes: Array<{
    id: string;
    outcome_type: string;
    amount_collected_paise: number | null;
    captured_at_device: string;
    synced_at_server: string;
    gps_lat: number;
    gps_lng: number;
    gps_accuracy_m: number;
    idempotency_key: string;
    officer: { name: string };
    loan: { borrower_name: string; account_number: string; pincode: string };
  }>;
  recentContacts: Array<{
    id: string;
    channel: string;
    status: string;
    attempted_at: string;
    ist_time: string;
    gps_lat: number | null;
    gps_lng: number | null;
    details: string | null;
    officer: { name: string };
    loan: { borrower_name: string; account_number: string; pincode: string };
  }>;
}

export function ManagerDashboard({
  loans,
  onUpdateLoanLocally,
  onRefreshLoans,
  language,
  hasMoreLoans,
  isLoadingMoreLoans,
  totalLoanCount,
  totalExposurePaise,
  uncertainLoanCount,
  onLoadMoreLoans,
}: ManagerDashboardProps) {
  const [selectedPincode, setSelectedPincode] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeOverrideLoan, setActiveOverrideLoan] = useState<LoanRecord | null>(null);
  const [metrics, setMetrics] = useState<ManagerMetrics | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImportingBranches, setIsImportingBranches] = useState(false);
  const branchFileInputRef = useRef<HTMLInputElement>(null);

  const fetchMetrics = useCallback(async () => {
    setIsLoadingMetrics(true);
    try {
      const response = await fetch('/api/manager/metrics');
      if (!response.ok) throw new Error('Could not load management reports.');
      setMetrics(await response.json());
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Could not load management reports.');
    } finally {
      setIsLoadingMetrics(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setImportMessage(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/loans/import', { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) {
        const rowErrors = Array.isArray(result.errors)
          ? result.errors.map((item: { row: number; message: string }) => `Row ${item.row}: ${item.message}`).join(' ')
          : '';
        throw new Error([result.error, rowErrors].filter(Boolean).join(' '));
      }
      const errorSummary = result.errors?.slice(0, 3)
        .map((item: { row: number; message: string }) => `Row ${item.row}: ${item.message}`)
        .join(' ');
      const unassignedSummary = result.unassigned?.slice(0, 3)
        .map((item: { row: number; accountNumber: string; pincode: string }) => `${item.accountNumber} (${item.pincode})`)
        .join(', ');
      setImportMessage(
        `Import complete: ${result.rowsCreated} new, ${result.rowsUpdated} updated, ${result.rowsRejected} rejected, ${result.rowsUnassigned || 0} unassigned.${errorSummary ? ` ${errorSummary}` : ''}${unassignedSummary ? ` No eligible pincode officer: ${unassignedSummary}` : ''}`
      );
      await Promise.all([fetchMetrics(), onRefreshLoans()]);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'CSV import failed.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBranchMasterImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImportingBranches(true);
    setImportMessage(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/branches/import', { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Branch master import failed.');
      setImportMessage(
        `Branch master updated: ${result.branchesImported} branches and ${result.rowsImported} pincode mappings. Import the next overdue snapshot to refresh branch roll rates.`
      );
      await Promise.all([fetchMetrics(), onRefreshLoans()]);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Branch master import failed.');
    } finally {
      setIsImportingBranches(false);
      if (branchFileInputRef.current) branchFileInputRef.current.value = '';
    }
  };

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
  const kpis = {
    totalExposureRupees: Math.round(totalExposurePaise / 100),
    collectedTodayRupees: (metrics?.collectedTodayPaise || 0) / 100,
    brokenPtpCount: metrics?.promises.broken || 0,
    uncertainCount: uncertainLoanCount,
  };
  const pincodes = loans.reduce<string[]>((values, loan) => {
    if (!values.includes(loan.pincode)) values.push(loan.pincode);
    return values;
  }, []);

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-3 sm:px-4 pb-28 pt-4">

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">Daily overdue import</h2>
            <p className="text-xs text-slate-500 mt-1">
              Import a CSV to refresh balances, recalculate priorities, snapshot roll-rate cohorts and balance assignments by pincode.
            </p>
            {metrics?.rollRate.latestImport && (
              <p className="text-[11px] text-slate-400 mt-1">
                Latest: {metrics.rollRate.latestImport.filename} · {new Date(metrics.rollRate.latestImport.imported_at).toLocaleString()}
              </p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvImport}
            className="sr-only"
            aria-label="Choose overdue loans CSV"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="touch-target inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {isImporting ? 'Importing…' : 'Import overdue CSV'}
          </button>
        </div>
        {importMessage && (
          <p role="status" className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
            {importMessage}
          </p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Required CSV columns: Loan ID, Borrower, Outstanding, DPD and Pincode. Optional: EMI, Promise Date, Phone, Owner, Business Type and GPS coordinates.
        </p>
        <details className="mt-3 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
            Manage branch master
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[11px] text-slate-500">
              Upload the complete approved master: branch_code, branch_name, pincode. Unlisted pincode mappings are removed.
            </p>
            <input
              ref={branchFileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleBranchMasterImport}
              className="sr-only"
              aria-label="Choose branch master CSV"
            />
            <button
              type="button"
              onClick={() => branchFileInputRef.current?.click()}
              disabled={isImportingBranches}
              className="touch-target rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isImportingBranches ? 'Importing branch master…' : 'Import branch master CSV'}
            </button>
          </div>
        </details>
      </section>
      
      {/* Portfolio Manager Header */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              Management Portal
            </span>
            <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full">
              Portfolio Overview
            </span>
          </div>
          <h2 className="text-xl font-bold mt-1">
            {language === 'hi' ? 'पोर्टफोलियो संग्रह एवं एआई निगरानी' : 'Portfolio Collections & AI Governance'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manager view &bull; {totalLoanCount} accounts across the portfolio
          </p>
        </div>

        {/* Pincode Scope Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-xl border border-slate-700">
          {[
            { id: 'ALL', label: 'All Pincodes' },
            ...pincodes.map((pincode) => ({
              id: pincode,
              label: pincode,
            })),
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
          <span className="text-[11px] text-emerald-700 font-medium">Logged payment outcomes today</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">1–30 DPD roll rate by branch</h3>
              <p className="text-xs text-slate-500 mt-1">
                Compares the two latest imported snapshots for movement into 31–60 DPD. Target: 16%.
              </p>
            </div>
            <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-sm font-black text-indigo-800">
              {metrics?.rollRate.rate === null || metrics?.rollRate.rate === undefined
                ? '—'
                : `${metrics.rollRate.rate}%`}
            </span>
          </div>
          {isLoadingMetrics ? (
            <p className="mt-4 text-xs text-slate-400">Loading latest import report…</p>
          ) : !metrics?.rollRate.eligible ? (
            <p className="mt-4 text-xs text-slate-500">Import two daily CSV snapshots to calculate observed roll rates.</p>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-600">
                {metrics.rollRate.rolled} of {metrics.rollRate.eligible} accounts moved to 31–60 DPD.
              </p>
              {metrics.rollRate.byBranch.map((branch) => (
                <div key={branch.branch}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-700">{branch.branch}</span>
                    <span className="text-slate-500">{branch.rolled}/{branch.eligible} · {branch.rate}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.min(branch.rate, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">Score back-test · last 30 days</h3>
              <p className="text-xs text-slate-500 mt-1">{metrics?.backtest.note || 'Waiting for imported cohorts and observed payment data.'}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {metrics?.backtest.scoreBands.map((band) => (
              <div key={band.band} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-[11px] font-semibold text-slate-600">{band.band}</p>
                <p className="mt-1 text-lg font-black text-slate-900">
                  {band.paymentRate === null ? '—' : `${band.paymentRate}%`}
                </p>
                <p className="text-[10px] text-slate-400">{band.paidCount}/{band.sampleSize} paid</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Descriptive signal only; payment counts are not proof that the score caused repayment.
          </p>
        </section>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">Promise-to-pay tracker</h3>
            <p className="text-xs text-slate-500 mt-1">{metrics?.promises.active || 0} active · {metrics?.promises.broken || 0} broken</p>
          </div>
          <span className="text-xs text-slate-500">Next 20 / recent promises</span>
        </div>
        {metrics?.promises.items.length ? (
          <div className="divide-y divide-slate-100">
            {metrics.promises.items.map((promise) => (
              <div key={promise.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
                <div>
                  <strong className="block text-slate-800">{promise.loan.borrower_name}</strong>
                  <span className="text-slate-500">{promise.loan.account_number} · {promise.loan.pincode}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-600">₹{(promise.promised_amount_paise / 100).toLocaleString('en-IN')} · {new Date(promise.promise_date).toLocaleDateString()}</span>
                  <span className={`rounded-full px-2 py-1 font-bold ${promise.status === 'BROKEN' ? 'bg-rose-100 text-rose-700' : 'bg-blue-50 text-blue-700'}`}>
                    {promise.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-4 text-xs text-slate-500">Promises appear here after officers log a promise-to-pay outcome.</p>
        )}
      </section>

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
            {hasMoreLoans
              ? `No uncertain accounts in the ${loans.length} loaded records. Load more to inspect the rest of the portfolio.`
              : 'No uncertain or dispute-held accounts in the selected portfolio.'}
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

      {hasMoreLoans && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">
            Showing {loans.length} of {totalLoanCount} portfolio accounts
          </p>
          <button
            type="button"
            onClick={onLoadMoreLoans}
            disabled={isLoadingMoreLoans}
            className="touch-target rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {isLoadingMoreLoans ? 'Loading…' : 'Load next 100 accounts'}
          </button>
        </div>
      )}

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
              {(metrics?.recentOutcomes || []).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition">
                  <td className="p-3 font-semibold text-slate-900">{log.officer.name}</td>
                  <td className="p-3">
                    <strong className="text-slate-800 block">{log.loan.borrower_name}</strong>
                    <span className="text-[11px] text-blue-600 font-medium">{log.outcome_type}</span>
                  </td>
                  <td className="p-3 text-slate-600">{new Date(log.captured_at_device).toLocaleString()}</td>
                  <td className="p-3">
                    <span className="text-emerald-700 font-medium">{new Date(log.synced_at_server).toLocaleString()}</span>
                  </td>
                  <td className="p-3 font-mono text-slate-700">{log.gps_lat.toFixed(4)}, {log.gps_lng.toFixed(4)} (±{log.gps_accuracy_m}m)</td>
                  <td className="p-3">
                    <span className="bg-slate-100 text-slate-700 font-mono text-[10px] px-2 py-0.5 rounded border border-slate-200">
                      {log.idempotency_key}
                    </span>
                  </td>
                </tr>
              ))}
              {(metrics?.recentContacts || []).map((log) => (
                <tr key={log.id} className={`hover:bg-slate-50/80 transition ${log.status === 'BLOCKED' ? 'bg-rose-50/50' : ''}`}>
                  <td className="p-3 font-semibold text-slate-900">{log.officer.name}</td>
                  <td className="p-3">
                    <strong className="text-slate-800 block">{log.loan.borrower_name}</strong>
                    <span className={`text-[11px] font-medium ${log.status === 'BLOCKED' ? 'text-rose-700' : 'text-indigo-700'}`}>
                      {log.channel} · {log.status}
                    </span>
                    {log.details && <span className="block text-[10px] text-rose-700">{log.details}</span>}
                  </td>
                  <td className="p-3 text-slate-600">{new Date(log.attempted_at).toLocaleString()} · {log.ist_time}</td>
                  <td className="p-3 text-slate-500">Contact attempt</td>
                  <td className="p-3 font-mono text-slate-700">
                    {log.gps_lat === null || log.gps_lng === null ? '—' : `${log.gps_lat.toFixed(4)}, ${log.gps_lng.toFixed(4)}`}
                  </td>
                  <td className="p-3 text-slate-400">—</td>
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
