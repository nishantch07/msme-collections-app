'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, Navigation, ShieldAlert, AlertTriangle, IndianRupee, Calendar, FileText } from 'lucide-react';
import { queueOfflineOutcome } from '@/lib/offline-db';
import { checkRbiCompliance } from '@/lib/compliance';

export interface LoanRecord {
  id: string;
  account_number: string;
  borrower_name: string;
  owner_name: string;
  phone: string;
  business_type: string;
  outstanding_paise: number;
  emi_amount_paise: number;
  dpd: number;
  pincode: string;
  gps_lat: number | null;
  gps_lng: number | null;
  priority_score: number;
  priority_breakdown: string;
  ai_confidence: 'HIGH' | 'LOW_CONFIDENCE' | 'DISPUTE_HOLD';
  ai_uncertainty_reason: string | null;
  manual_override_score: number | null;
  manual_override_reason: string | null;
  promises_to_pay?: Array<{
    id: string;
    promised_amount_paise: number;
    promise_date: string;
    status: string;
  }>;
}

interface VisitDrawerProps {
  loan: LoanRecord | null;
  onClose: () => void;
  isOnline: boolean;
  simulatedHour: number | null;
  onOutcomeLogged: (updatedLoan?: LoanRecord, offlineItem?: { outcome_type: string; loan_id: string; amount_collected_paise?: number | null }) => void;
  language: 'en' | 'hi';
}

type OutcomeType = 'PAID' | 'PTP' | 'UNREACHABLE' | 'DISPUTE' | 'REFUSED';

export function VisitDrawer({
  loan,
  onClose,
  isOnline,
  simulatedHour,
  onOutcomeLogged,
  language,
}: VisitDrawerProps) {
  const isNightLocked = simulatedHour === null
    ? !checkRbiCompliance().isAllowed
    : simulatedHour >= 19 || simulatedHour < 8;

  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeType>('PAID');
  const [amountCollectedRupees, setAmountCollectedRupees] = useState<string>(
    loan ? Math.round(loan.emi_amount_paise / 100).toString() : '0'
  );
  const [promisedAmountRupees, setPromisedAmountRupees] = useState<string>(
    loan ? Math.round(loan.emi_amount_paise / 100).toString() : '0'
  );
  const [promiseDate, setPromiseDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [gpsPosition, setGpsPosition] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isCapturingGps, setIsCapturingGps] = useState(false);

  const captureGps = useCallback(() => {
    if (!loan) return;
    if (!navigator.geolocation) {
      setGpsError('This device/browser does not provide GPS location.');
      return;
    }
    setGpsPosition(null);
    setIsCapturingGps(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setIsCapturingGps(false);
      },
      (error) => {
        setGpsError(error.message || 'Location permission or GPS signal is unavailable.');
        setGpsPosition(null);
        setIsCapturingGps(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, [loan]);

  useEffect(() => {
    if (loan) captureGps();
  }, [loan, captureGps]);

  if (!loan) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // If RBI Night Lock is active, show explicit blocker
    if (isNightLocked) {
      setErrorMsg('RBI Fair Practices Lockout: Contact and visit logging are strictly prohibited between 19:00 and 08:00 IST.');
      return;
    }
    if (!gpsPosition) {
      setErrorMsg('Capture your location before saving this field visit.');
      return;
    }

    setIsSubmitting(true);

    const idempotencyKey = `outcome-${loan.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const capturedAt = new Date().toISOString();

    const payload = {
      idempotency_key: idempotencyKey,
      loan_id: loan.id,
      outcome_type: selectedOutcome,
      amount_collected_paise:
        selectedOutcome === 'PAID' ? Math.round(parseFloat(amountCollectedRupees || '0') * 100) : null,
      promised_amount_paise:
        selectedOutcome === 'PTP' ? Math.round(parseFloat(promisedAmountRupees || '0') * 100) : null,
      promise_date: selectedOutcome === 'PTP' ? promiseDate : null,
      notes: notes || 'Field visit recorded.',
      gps_lat: gpsPosition.latitude,
      gps_lng: gpsPosition.longitude,
      gps_accuracy_m: gpsPosition.accuracy,
      captured_at_device: capturedAt,
    };

    if (!isOnline) {
      // Offline Mode: Store in IndexedDB
      try {
        await queueOfflineOutcome({
          ...payload,
        });
        setIsSubmitting(false);
        onOutcomeLogged(undefined, payload);
        onClose();
      } catch (err: unknown) {
        setIsSubmitting(false);
        const msg = err instanceof Error ? err.message : 'Storage error';
        setErrorMsg('Failed to store outcome in offline IndexedDB: ' + msg);
      }
      return;
    }

    // Online Mode: Send directly to REST API
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (simulatedHour !== null) {
        headers['x-simulated-ist-hour'] = simulatedHour.toString();
      }

      const res = await fetch(`/api/loans/${loan.id}/outcome`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.details || data.message || data.error || 'Failed to save outcome');
      }

      setIsSubmitting(false);
      onOutcomeLogged(data.loan, data.outcomeLog);
      onClose();
    } catch (err: unknown) {
      if (err instanceof TypeError || err instanceof SyntaxError) {
        try {
          await queueOfflineOutcome(payload);
          setIsSubmitting(false);
          onOutcomeLogged(undefined, payload);
          onClose();
          return;
        } catch (storageError: unknown) {
          const message = storageError instanceof Error ? storageError.message : 'Offline storage error';
          setErrorMsg(`Network unavailable and offline save failed: ${message}`);
        }
      } else {
        const message = err instanceof Error ? err.message : 'Error communicating with server.';
        setErrorMsg(message);
      }
      setIsSubmitting(false);
    }
  };

  const outcomeChips: Array<{ id: OutcomeType; labelEn: string; labelHi: string; color: string }> = [
    { id: 'PAID', labelEn: 'Paid (₹)', labelHi: 'भुगतान प्राप्त (₹)', color: 'bg-emerald-600 text-white border-emerald-600' },
    { id: 'PTP', labelEn: 'Promise to Pay', labelHi: 'वादा (PTP)', color: 'bg-blue-600 text-white border-blue-600' },
    { id: 'UNREACHABLE', labelEn: 'Unreachable', labelHi: 'संपर्क नहीं हुआ', color: 'bg-amber-600 text-white border-amber-600' },
    { id: 'DISPUTE', labelEn: 'Dispute Raised', labelHi: 'विवाद दर्ज (Dispute)', color: 'bg-rose-600 text-white border-rose-600' },
    { id: 'REFUSED', labelEn: 'Refused', labelHi: 'मना किया (Refused)', color: 'bg-slate-700 text-white border-slate-700' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-base sm:text-lg">
                {language === 'hi' ? '3-टैप विजिट परिणाम दर्ज करें' : '3-Tap Visit Logger'}
              </h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOnline ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`}>
                {isOnline ? 'ONLINE' : 'OFFLINE STORE'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5 font-medium">
              {loan.borrower_name} &bull; {loan.account_number}
            </p>
          </div>
          <button
            onClick={onClose}
            className="touch-target p-2 text-slate-400 hover:text-white rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* RBI Warning if night locked */}
          {isNightLocked && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-red-800 text-xs flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">RBI Fair Practices Contact Lockout Active</p>
                <p className="mt-0.5">
                  The simulated clock is past 19:00 IST. The RBI Fair Practices Code strictly forbids outbound recovery visits and contacts.
                </p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* TAP 1: Status Chips */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Step 1: Tap Visit Outcome
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {outcomeChips.map((chip) => {
                const isSelected = selectedOutcome === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setSelectedOutcome(chip.id)}
                    className={`touch-target p-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition text-center flex flex-col items-center justify-center gap-1 ${
                      isSelected
                        ? `${chip.color} shadow-md scale-[1.02]`
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{language === 'hi' ? chip.labelHi : chip.labelEn}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic Context Fields based on Outcome */}
          {selectedOutcome === 'PAID' && (
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2">
              <label className="block text-xs font-bold text-emerald-900">
                Amount Collected (₹)
              </label>
              <div className="relative">
                <IndianRupee className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="number"
                  value={amountCollectedRupees}
                  onChange={(e) => setAmountCollectedRupees(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-lg text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. 42000"
                  required
                />
              </div>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setAmountCollectedRupees(Math.round(loan.emi_amount_paise / 100).toString())}
                  className="px-2 py-1 bg-white border border-emerald-300 rounded text-emerald-800 font-medium hover:bg-emerald-100"
                >
                  Full EMI (₹{(loan.emi_amount_paise / 100).toLocaleString('en-IN')})
                </button>
                <button
                  type="button"
                  onClick={() => setAmountCollectedRupees(Math.round(loan.outstanding_paise / 100).toString())}
                  className="px-2 py-1 bg-white border border-emerald-300 rounded text-emerald-800 font-medium hover:bg-emerald-100"
                >
                  Full Principal (₹{(loan.outstanding_paise / 100).toLocaleString('en-IN')})
                </button>
              </div>
            </div>
          )}

          {selectedOutcome === 'PTP' && (
            <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-3">
              <div>
                <label className="block text-xs font-bold text-blue-900 mb-1">
                  Promised Amount (₹)
                </label>
                <div className="relative">
                  <IndianRupee className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="number"
                    value={promisedAmountRupees}
                    onChange={(e) => setPromisedAmountRupees(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-blue-900 mb-1">
                  Promise Date
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="date"
                    value={promiseDate}
                    onChange={(e) => setPromiseDate(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {selectedOutcome === 'DISPUTE' && (
            <div className="p-3.5 bg-rose-50/60 border border-rose-200 rounded-xl space-y-2">
              <label className="block text-xs font-bold text-rose-900">
                Dispute Reason Quick Tag
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'GST Invoice Mismatch',
                  'Defective Stock Return',
                  'Moratorium / Restructuring Requested',
                  'Branch Ledger Discrepancy',
                ].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setNotes((prev) => (prev ? `${prev}; ${tag}` : tag))}
                    className="px-2 py-1 bg-white border border-rose-300 text-rose-800 text-xs rounded hover:bg-rose-100 font-medium"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAP 2: Capture actual device GPS */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center justify-between font-bold text-slate-800">
              <span className="flex items-center gap-1">
                <Navigation className="w-3.5 h-3.5 text-blue-600" />
                Step 2: Device GPS location
              </span>
              {gpsPosition && <span className="text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                ±{Math.round(gpsPosition.accuracy)}m accuracy
              </span>}
            </div>
            {gpsPosition
              ? <p className="font-mono text-[11px] text-slate-700">{gpsPosition.latitude.toFixed(5)}, {gpsPosition.longitude.toFixed(5)}</p>
              : <p className="text-[11px] text-slate-600">{isCapturingGps ? 'Waiting for GPS signal…' : gpsError || 'Location required to save this visit.'}</p>}
            <button type="button" onClick={captureGps} disabled={isCapturingGps} className="touch-target rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 disabled:opacity-50">
              {isCapturingGps ? 'Locating…' : gpsPosition ? 'Refresh location' : 'Retry location'}
            </button>
          </div>

          {/* Field Notes Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3 text-slate-500" />
              Field Visit Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Met owner Venkatesh at factory. Confirmed receipt of materials..."
              className="w-full p-2.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* TAP 3: Submit Action Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || isNightLocked || !gpsPosition}
              className={`touch-target w-full py-3.5 rounded-xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg transition ${
                isNightLocked
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : isOnline
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/25'
                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-500/25'
              }`}
            >
              <CheckCircle className="w-5 h-5" />
              <span>
                {isSubmitting
                  ? 'Recording...'
                  : isOnline
                  ? 'Step 3: Save & Sync Outcome'
                  : 'Step 3: Queue in Offline IndexedDB'}
              </span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
