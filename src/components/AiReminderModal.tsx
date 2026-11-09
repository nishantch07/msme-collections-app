'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Send,
  Copy,
  Check,
  Languages,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
import { LoanRecord } from './VisitDrawer';
import { queueOfflineContactAttempt } from '@/lib/offline-db';
import { checkRbiCompliance } from '@/lib/compliance';

interface AiReminderModalProps {
  loan: LoanRecord | null;
  onClose: () => void;
  officerName?: string;
  simulatedHour: number | null;
  isOnline: boolean;
  onContactAttemptQueued: () => void;
}

export function AiReminderModal({
  loan,
  onClose,
  officerName = 'Ramesh Kumar',
  simulatedHour,
  isOnline,
  onContactAttemptQueued,
}: AiReminderModalProps) {
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [draft, setDraft] = useState<string>('');
  const [approvedDraft, setApprovedDraft] = useState<string>('');
  const [sanitizedDraft, setSanitizedDraft] = useState<string>('');
  const [isSafe, setIsSafe] = useState<boolean>(true);
  const [violations, setViolations] = useState<string[]>([]);
  const [provider, setProvider] = useState<string>('dlt-template');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Guardrail Stress-Tester input
  const [customTestText, setCustomTestText] = useState<string>('');
  const [isTestingCustom, setIsTestingCustom] = useState<boolean>(false);
  const [customTestResult, setCustomTestResult] = useState<{ safe: boolean; sanitizedDraft: string; violations: string[] } | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [isOpeningWhatsApp, setIsOpeningWhatsApp] = useState(false);
  const isProduction = process.env.NODE_ENV === 'production';

  // Fetch initial reminder
  const fetchReminder = useCallback(async (lang: 'en' | 'hi') => {
    if (!loan) return;
    setIsLoading(true);
    const activePromise = loan.promises_to_pay
      ?.filter((promise) => promise.status === 'ACTIVE')
      .sort((left, right) => new Date(left.promise_date).getTime() - new Date(right.promise_date).getTime())[0];
    try {
      const res = await fetch('/api/ai/reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(simulatedHour !== null ? { 'x-simulated-ist-hour': simulatedHour.toString() } : {}),
        },
        body: JSON.stringify({
          loan_id: loan.id,
          ...(activePromise ? {
            promise_date: activePromise.promise_date,
            promised_amount_paise: activePromise.promised_amount_paise,
          } : {}),
          borrower_name: loan.borrower_name,
          owner_name: loan.owner_name,
          account_number: loan.account_number,
          outstanding_paise: loan.outstanding_paise,
          emi_amount_paise: loan.emi_amount_paise,
          language: lang,
          officer_name: officerName,
        }),
      });

      const data = await res.json();
      setDraft(data.draft || '');
      setApprovedDraft(data.approvedTemplateDraft || data.sanitizedDraft || data.draft || '');
      setSanitizedDraft(data.sanitizedDraft || data.draft || '');
      setIsSafe(data.safe ?? true);
      setViolations(data.violations || []);
      setProvider(data.provider || 'dlt-template');
    } catch (err) {
      console.error('Failed to generate reminder:', err);
    } finally {
      setIsLoading(false);
    }
  }, [loan, officerName, simulatedHour]);

  useEffect(() => {
    if (loan) {
      fetchReminder(language);
    }
  }, [fetchReminder, language, loan]);

  // Test custom text against guardrail filter
  const testCustomGuardrail = async (textToTest: string) => {
    if (!loan) return;
    setIsTestingCustom(true);
    const activePromise = loan.promises_to_pay
      ?.filter((promise) => promise.status === 'ACTIVE')
      .sort((left, right) => new Date(left.promise_date).getTime() - new Date(right.promise_date).getTime())[0];
    try {
      const res = await fetch('/api/ai/reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loan_id: loan.id,
          ...(activePromise ? {
            promise_date: activePromise.promise_date,
            promised_amount_paise: activePromise.promised_amount_paise,
          } : {}),
          borrower_name: loan.borrower_name,
          owner_name: loan.owner_name,
          account_number: loan.account_number,
          outstanding_paise: loan.outstanding_paise,
          emi_amount_paise: loan.emi_amount_paise,
          language,
          custom_draft: textToTest,
        }),
      });

      const data = await res.json();
      setCustomTestResult({
        safe: data.safe ?? false,
        sanitizedDraft: data.sanitizedDraft || textToTest,
        violations: data.violations || [],
      });
    } catch (err) {
      console.error('Guardrail test error:', err);
    } finally {
      setIsTestingCustom(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(approvedDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenWhatsApp = async () => {
    if (!loan || isOpeningWhatsApp) return;
    setContactError(null);
    if (!loan.phone.replace(/[^\d]/g, '')) {
      setContactError(isProduction
        ? 'No borrower phone is available. Production messaging is not configured.'
        : 'No borrower phone is available. You can still copy the approved template.');
      return;
    }
    setIsOpeningWhatsApp(true);
    const idempotencyKey = `contact-${loan.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      if (!isOnline) {
        const compliance = checkRbiCompliance(
          simulatedHour === null ? undefined : { simulatedHour }
        );
        await queueOfflineContactAttempt({
          idempotency_key: idempotencyKey,
          loan_id: loan.id,
          channel: 'WHATSAPP',
          attempted_at_device: new Date().toISOString(),
          ist_time: compliance.currentTimeString,
          status: compliance.isAllowed && !isProduction ? 'INITIATED' : 'BLOCKED',
          details: isProduction
            ? 'Production messaging is disabled until an approved template and sending integration are configured.'
            : compliance.isAllowed ? undefined : compliance.reason,
        });
        onContactAttemptQueued();
        if (isProduction) {
          setContactError('WhatsApp is disabled in production until the approved template and sending integration are configured. The blocked attempt was saved for sync.');
          return;
        }
        if (!compliance.isAllowed) {
          setContactError(`Blocked outside the RBI contact window (${compliance.currentTimeString}). The attempt was saved for sync.`);
          return;
        }
      } else {
        const response = await fetch('/api/contact-attempts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idempotency_key: idempotencyKey,
            loan_id: loan.id,
            channel: 'WHATSAPP',
            ...(simulatedHour === null ? {} : { simulated_hour: simulatedHour }),
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          setContactError(result.message || 'Contact blocked. The attempt was recorded.');
          return;
        }
      }

      window.location.href = whatsappUrl;
    } catch (error) {
      if (error instanceof TypeError) {
        const compliance = checkRbiCompliance(
          simulatedHour === null ? undefined : { simulatedHour }
        );
        try {
          await queueOfflineContactAttempt({
            idempotency_key: idempotencyKey,
            loan_id: loan.id,
            channel: 'WHATSAPP',
            attempted_at_device: new Date().toISOString(),
            ist_time: compliance.currentTimeString,
            status: compliance.isAllowed && !isProduction ? 'INITIATED' : 'BLOCKED',
            details: isProduction
              ? 'Production messaging is disabled until an approved template and sending integration are configured.'
              : compliance.isAllowed ? undefined : compliance.reason,
          });
          onContactAttemptQueued();
          if (isProduction) {
            setContactError('WhatsApp is disabled in production until the approved template and sending integration are configured. The blocked attempt was saved for sync.');
            return;
          }
          if (compliance.isAllowed) {
            window.location.href = whatsappUrl;
            return;
          }
          setContactError(`Blocked outside the RBI contact window (${compliance.currentTimeString}). The attempt was saved for sync.`);
          return;
        } catch (storageError) {
          setContactError(storageError instanceof Error ? storageError.message : 'Unable to save the attempt offline.');
          return;
        }
      }
      setContactError(error instanceof Error ? error.message : 'Unable to record the message attempt.');
    } finally {
      setIsOpeningWhatsApp(false);
    }
  };

  if (!loan) return null;

  const cleanPhone = loan.phone.replace(/[^\d]/g, '');
  const messageToSend = encodeURIComponent(approvedDraft);
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${messageToSend}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base sm:text-lg">AI Compliant Reminder</h2>
              <p className="text-xs text-slate-300 font-medium">
                {loan.borrower_name} &bull; EMI: ₹{(loan.emi_amount_paise / 100).toLocaleString('en-IN')}
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

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          
          {/* Controls: Language & Re-generate */}
          <div className="flex items-center justify-between bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`touch-target px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                  language === 'en'
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                English
              </button>
              <button
                type="button"
                onClick={() => setLanguage('hi')}
                className={`touch-target px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                  language === 'hi'
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                हिंदी
              </button>
            </div>

            <span className="text-[11px] text-slate-500 font-medium px-2">
              Engine: <strong className="text-slate-700 uppercase">{provider}</strong>
            </span>
          </div>

          {/* Guardrail Audit Badge Banner */}
          <div
            className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs transition ${
              isSafe
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-rose-50 border-rose-300 text-rose-900'
            }`}
          >
            {isSafe ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5 animate-bounce" />
            )}
            <div className="flex-1">
              <div className="flex items-center justify-between font-bold">
                <span>
                  {isSafe
                    ? 'GUARDRAIL AUDIT: 100% COMPLIANT (PASS)'
                    : 'GUARDRAIL ALERT: COERCION / HALLUCINATION BLOCKED'}
                </span>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-white border">
                  RBI Fair Practices
                </span>
              </div>
              {!isSafe && violations.length > 0 && (
                <ul className="mt-1.5 space-y-1 list-disc list-inside text-rose-800 font-medium">
                  {violations.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Approved message preview */}
          <div className="bg-[#e5ddd5] p-3 sm:p-4 rounded-xl border border-[#d1c7bc] space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
              {isProduction ? 'Non-sendable reminder preview' : 'Approved template · WhatsApp preview'}
              </span>
              <span>To: {loan.phone}</span>
            </div>
            {isProduction && (
              <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-950">
                Production WhatsApp is disabled. This preview is not confirmed as the lender&apos;s registered DLT template and cannot be copied or sent.
              </p>
            )}

            {/* Bubble */}
            <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm max-w-md text-xs sm:text-sm text-slate-800 leading-relaxed border border-slate-200">
              {isLoading ? (
                <div className="flex items-center gap-2 py-2 text-slate-500">
                  <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span>Synthesizing compliant draft...</span>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{approvedDraft}</p>
              )}
              <div className="text-right text-[10px] text-slate-400 mt-1">14:30 &#10003;&#10003;</div>
            </div>

            {!isSafe && (
              <p className="text-[11px] text-amber-900 bg-amber-100 p-1.5 rounded font-medium">
                The AI suggestion was flagged. Only the approved template shown above can be copied or opened in WhatsApp.
              </p>
            )}
          </div>

          {draft && draft !== approvedDraft && (
            <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-700">Review AI suggestion (advisory; not sendable)</summary>
              <p className="mt-2 whitespace-pre-wrap text-slate-600">{isSafe ? draft : sanitizedDraft}</p>
            </details>
          )}

          {/* Interactive Guardrail Stress Tester Sandbox */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Reviewer Stress-Test: Try Aggressive / Prohibited Text
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Live Guardrail</span>
            </div>
            
            <p className="text-[11px] text-slate-600">
              These tests are isolated from the approved message and cannot be sent.
            </p>

            <div className="flex flex-wrap gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  const t = 'Pay today or police will seize your workshop and put you in jail.';
                  setCustomTestText(t);
                  testCustomGuardrail(t);
                }}
                className="px-2 py-1 bg-white border border-rose-300 text-rose-800 rounded hover:bg-rose-50 text-[11px] font-medium"
              >
                &ldquo;Police &amp; jail seizure threat&rdquo;
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = 'Court warrant issued for defaulter, public auction starts tomorrow.';
                  setCustomTestText(t);
                  testCustomGuardrail(t);
                }}
                className="px-2 py-1 bg-white border border-rose-300 text-rose-800 rounded hover:bg-rose-50 text-[11px] font-medium"
              >
                &ldquo;Defaulter &amp; auction&rdquo;
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = 'आज ही भुगतान करो वरना पुलिस गिरफ्तार करेगी और जब्ती होगी';
                  setCustomTestText(t);
                  testCustomGuardrail(t);
                }}
                className="px-2 py-1 bg-white border border-rose-300 text-rose-800 rounded hover:bg-rose-50 text-[11px] font-medium"
              >
                &ldquo;हिंदी: पुलिस/गिरफ्तार/जब्त&rdquo;
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = 'Your pending loan amount is ₹9,99,999. Pay immediately.';
                  setCustomTestText(t);
                  testCustomGuardrail(t);
                }}
                className="px-2 py-1 bg-white border border-amber-300 text-amber-800 rounded hover:bg-amber-50 text-[11px] font-medium"
              >
                &ldquo;Phantom amount ₹9,99,999&rdquo;
              </button>
            </div>

            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={customTestText}
                onChange={(e) => setCustomTestText(e.target.value)}
                placeholder="Type custom message to stress-test guardrail..."
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={!customTestText.trim() || isTestingCustom}
                onClick={() => testCustomGuardrail(customTestText)}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
              >
                {isTestingCustom ? 'Testing...' : 'Audit Live'}
              </button>
            </div>
            {customTestResult && (
              <div className={`rounded-lg border p-2 text-[11px] ${customTestResult.safe ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                <strong>{customTestResult.safe ? 'No prohibited terms found.' : 'Flagged test text; approved template is unchanged.'}</strong>
                {!customTestResult.safe && <p className="mt-1 whitespace-pre-wrap">{customTestResult.sanitizedDraft}</p>}
                {customTestResult.violations.length > 0 && <p className="mt-1">{customTestResult.violations.join(' · ')}</p>}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={isProduction}
              className="touch-target py-3 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 font-semibold text-xs sm:text-sm text-slate-800 flex items-center justify-center gap-2 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-600" />}
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenWhatsApp}
              disabled={isLoading || isOpeningWhatsApp || !approvedDraft || !loan.phone.replace(/[^\d]/g, '')}
              className="touch-target py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{isOpeningWhatsApp ? 'Recording…' : isProduction ? 'Log blocked message attempt' : 'Review & open WhatsApp'}</span>
            </button>
          </div>
          {contactError && <p role="alert" className="rounded-lg bg-rose-50 border border-rose-200 p-2 text-xs text-rose-800">{contactError}</p>}

        </div>

      </div>
    </div>
  );
}
