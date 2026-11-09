'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { FieldOfficerQueue } from '@/components/FieldOfficerQueue';
import { ManagerDashboard } from '@/components/ManagerDashboard';
import { DemoToolbar } from '@/components/DemoToolbar';
import { LoanRecord } from '@/components/VisitDrawer';
import { getPendingOfflineOutcomes, flushOfflineQueue } from '@/lib/offline-db';

export default function HomePage() {
  const router = useRouter();

  // User session state
  const [user, setUser] = useState<{
    id: string;
    name: string;
    email: string;
    role: 'OFFICER' | 'MANAGER';
    assignedPincode: string;
  } | null>(null);

  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [isLoadingLoans, setIsLoadingLoans] = useState(true);

  // Demo Toolbar controls
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [simulatedHour, setSimulatedHour] = useState<number | null>(14.5); // Default to 14:30 IST (Open)
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [isFlushing, setIsFlushing] = useState<boolean>(false);

  // Sync count helper
  const updatePendingCount = useCallback(async () => {
    try {
      const pending = await getPendingOfflineOutcomes();
      setPendingSyncCount(pending.length);
    } catch {
      // idb error fallback
    }
  }, []);

  // Fetch loans from API
  const fetchLoans = useCallback(async () => {
    try {
      setIsLoansLoading(true);
      const res = await fetch('/api/loans');
      if (res.ok) {
        const data = await res.json();
        setLoans(data.loans || []);
      }
    } catch (err) {
      console.error('Error fetching loans:', err);
    } finally {
      setIsLoansLoading(false);
    }
  }, []);

  const setIsLoansLoading = (val: boolean) => setIsLoadingLoans(val);

  // Initialize auth
  useEffect(() => {
    async function initSession() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser({
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            role: data.user.role,
            assignedPincode: data.user.assigned_pincode,
          });
        } else {
          // Check local storage or set default demo officer
          const local = localStorage.getItem('msme_user');
          if (local) {
            const parsed = JSON.parse(local);
            setUser({
              id: parsed.userId || parsed.id || 'seed-officer',
              name: parsed.name || 'Ramesh Kumar',
              email: parsed.email || 'officer@msmelender.in',
              role: parsed.role || 'OFFICER',
              assignedPincode: parsed.assignedPincode || '560058',
            });
          } else {
            // Default reviewer starting persona: Ramesh Kumar (Field Officer)
            setUser({
              id: 'seed-officer',
              name: 'Ramesh Kumar',
              email: 'officer@msmelender.in',
              role: 'OFFICER',
              assignedPincode: '560058',
            });
          }
        }
      } catch {
        setUser({
          id: 'seed-officer',
          name: 'Ramesh Kumar',
          email: 'officer@msmelender.in',
          role: 'OFFICER',
          assignedPincode: '560058',
        });
      } finally {
        setIsLoadingAuth(false);
      }
    }

    initSession();
    fetchLoans();
    updatePendingCount();
  }, [fetchLoans, updatePendingCount]);

  // Handle Role Switch
  const handleRoleSwitch = (newRole: 'OFFICER' | 'MANAGER') => {
    if (newRole === 'OFFICER') {
      setUser({
        id: 'seed-officer',
        name: 'Ramesh Kumar',
        email: 'officer@msmelender.in',
        role: 'OFFICER',
        assignedPincode: '560058',
      });
    } else {
      setUser({
        id: 'seed-manager',
        name: 'Priya Nair',
        email: 'manager@msmelender.in',
        role: 'MANAGER',
        assignedPincode: 'ALL',
      });
    }
  };

  // Handle Online/Offline toggle
  const handleToggleOnline = () => {
    setIsOnline((prev) => !prev);
  };

  // Handle RBI Clock Toggle (14:30 vs 20:45)
  const handleToggleRbiClock = () => {
    setSimulatedHour((prev) => (prev === 20.75 ? 14.5 : 20.75));
  };

  // Handle Flush Sync
  const handleFlushSync = async () => {
    setIsFlushing(true);
    try {
      const result = await flushOfflineQueue(simulatedHour);
      await updatePendingCount();
      await fetchLoans();
      alert(`✅ Batch Sync Complete: ${result.syncedCount} records synced, ${result.duplicateCount} duplicate idempotency receipts verified.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      alert(`Sync failed: ${msg}`);
    } finally {
      setIsFlushing(false);
    }
  };

  // Local optimistic update for loan record
  const handleUpdateLoanLocally = (updatedLoan: LoanRecord) => {
    setLoans((prev) =>
      prev.map((l) => (l.id === updatedLoan.id ? { ...l, ...updatedLoan } : l))
    );
  };

  // Local optimistic handler when an outcome is queued in offline mode
  const handleQueueOfflineOutcome = (offlineItem: { outcome_type: string; loan_id: string; amount_collected_paise?: number | null }) => {
    updatePendingCount();
    // Optimistically update loan if payment was made
    if (offlineItem.outcome_type === 'PAID' && offlineItem.amount_collected_paise) {
      setLoans((prev) =>
        prev.map((l) => {
          if (l.id === offlineItem.loan_id) {
            const collected = offlineItem.amount_collected_paise || 0;
            const newOutstanding = Math.max(0, l.outstanding_paise - collected);
            return {
              ...l,
              outstanding_paise: newOutstanding,
              dpd: newOutstanding === 0 ? 0 : l.dpd,
            };
          }
          return l;
        })
      );
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('msme_user');
    router.push('/login');
  };

  if (isLoadingAuth || isLoadingLoans) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md text-center space-y-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-800">
            Loading MSME Collections Beat...
          </p>
          <span className="text-xs text-slate-400">Initializing offline store and priority queue</span>
        </div>
      </div>
    );
  }

  const currentRole = user?.role || 'OFFICER';

  return (
    <div className="min-h-screen bg-slate-100/60 text-slate-900 flex flex-col font-sans">
      
      {/* Top Navigation */}
      <Navbar
        userName={user?.name || 'Ramesh Kumar'}
        userRole={currentRole}
        assignedPincode={user?.assignedPincode || '560058'}
        simulatedHour={simulatedHour}
        onLogout={handleLogout}
        language={language}
      />

      {/* Main View: Officer Beat vs Manager Dashboard */}
      <main className="flex-1">
        {currentRole === 'OFFICER' ? (
          <FieldOfficerQueue
            loans={loans}
            isOnline={isOnline}
            simulatedHour={simulatedHour}
            language={language}
            onRefreshLoans={fetchLoans}
            onUpdateLoanLocally={handleUpdateLoanLocally}
            onQueueOfflineOutcome={handleQueueOfflineOutcome}
            officerName={user?.name || 'Ramesh Kumar'}
          />
        ) : (
          <ManagerDashboard
            loans={loans}
            onUpdateLoanLocally={handleUpdateLoanLocally}
            language={language}
          />
        )}
      </main>

      {/* Reviewer Demo Control Pill (Always visible at bottom) */}
      <DemoToolbar
        currentRole={currentRole}
        onRoleSwitch={handleRoleSwitch}
        isOnline={isOnline}
        onToggleOnline={handleToggleOnline}
        pendingSyncCount={pendingSyncCount}
        onFlushSync={handleFlushSync}
        simulatedHour={simulatedHour}
        onToggleRbiClock={handleToggleRbiClock}
        language={language}
        onToggleLanguage={() => setLanguage((prev) => (prev === 'en' ? 'hi' : 'en'))}
        isFlushing={isFlushing}
      />

    </div>
  );
}
