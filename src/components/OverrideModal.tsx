'use client';

import React, { useState } from 'react';
import { X, Sliders, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { LoanRecord } from './VisitDrawer';

interface OverrideModalProps {
  loan: LoanRecord | null;
  onClose: () => void;
  onOverrideSaved: (updatedLoan: any) => void;
  userRole: 'OFFICER' | 'MANAGER';
}

export function OverrideModal({
  loan,
  onClose,
  onOverrideSaved,
  userRole,
}: OverrideModalProps) {
  if (!loan) return null;

  const [overrideScore, setOverrideScore] = useState<number>(
    loan.manual_override_score !== null && loan.manual_override_score !== undefined
      ? loan.manual_override_score
      : Math.round(loan.priority_score)
  );
  const [reason, setReason] = useState<string>('');
  const [targetConfidence, setTargetConfidence] = useState<'HIGH' | 'LOW_CONFIDENCE' | 'DISPUTE_HOLD'>('HIGH');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setErrorMsg('Please provide a documented justification of at least 5 characters.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/loans/${loan.id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manual_override_score: Number(overrideScore),
          manual_override_reason: reason.trim(),
          target_confidence: targetConfidence,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit override');
      }

      onOverrideSaved(data.loan);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error saving override');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base sm:text-lg">Review &amp; Override AI Prioritisation</h2>
              <p className="text-xs text-slate-300 font-medium">
                {loan.borrower_name} &bull; {loan.account_number}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="touch-target p-2 text-slate-400 hover:text-white rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          
          {/* Current AI Uncertainty Reason Callout */}
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Current AI Flag: {loan.ai_confidence}</span>
            </div>
            <p className="leading-relaxed">
              {loan.ai_uncertainty_reason || 'AI detected sharp signal conflicts or unresolved field disputes on this account.'}
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-800 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Override Score Slider & Number Input */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Target Priority Score (0 - 100)
              </label>
              <span className="text-base font-black px-3 py-1 bg-blue-600 text-white rounded-lg shadow-sm">
                {overrideScore} / 100
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={overrideScore}
              onChange={(e) => setOverrideScore(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer"
            />

            <div className="flex justify-between text-[11px] text-slate-500 font-medium">
              <span>Low Priority (0)</span>
              <span>Default Score: {loan.priority_score.toFixed(1)}</span>
              <span>Urgent (100)</span>
            </div>
          </div>

          {/* Target Confidence State */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Action on AI Flag
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetConfidence('HIGH')}
                className={`touch-target p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  targetConfidence === 'HIGH'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Resolve Flag (HIGH)</span>
              </button>
              <button
                type="button"
                onClick={() => setTargetConfidence('DISPUTE_HOLD')}
                className={`touch-target p-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  targetConfidence === 'DISPUTE_HOLD'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span>Keep Dispute Hold</span>
              </button>
            </div>
          </div>

          {/* Documented Audit Justification */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Documented Reviewer Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Spoke to factory accountant; GST discrepancy clarified. Borrower committed to pay ₹42k on Friday."
              className="w-full p-2.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Recorded in audit trail as: [{userRole === 'OFFICER' ? 'Field Officer' : 'Portfolio Manager'}]
            </p>
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="touch-target w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 transition disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving Override...' : 'Commit Human Override'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
