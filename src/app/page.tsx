'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { FieldOfficerQueue } from '@/components/FieldOfficerQueue';
import { ManagerDashboard } from '@/components/ManagerDashboard';
import { DemoToolbar } from '@/components/DemoToolbar';
import { LoanRecord } from '@/components/VisitDrawer';
import {
  flushOfflineQueue,
  getLegacyOfflineQueueCount,
  getOfflineQueueCount,
  isOfflineVaultUnlocked,
  lockOfflineVault,
  setOfflineVaultUser,
  unlockOfflineVault,
} from '@/lib/offline-db';

export default function HomePage() {
  const router = useRouter();
  const isDemoMode = process.env.NODE_ENV !== 'production';

  // User session state
  const [user, setUser] = useState<{
    id: string;
    name: string;
    email: string;
    role: 'OFFICER' | 'MANAGER';
    assignedPincode: string;
  } | null>(null);

  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [offlineVaultUnlocked, setOfflineVaultUnlocked] = useState(false);
  const [offlinePassword, setOfflinePassword] = useState('');
  const [offlineUnlockError, setOfflineUnlockError] = useState<string | null>(null);
  const [legacyQueueCount, setLegacyQueueCount] = useState(0);
  const [confirmLegacyOwnership, setConfirmLegacyOwnership] = useState(false);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [isLoadingLoans, setIsLoadingLoans] = useState(true);
  const [isLoadingMoreLoans, setIsLoadingMoreLoans] = useState(false);
  const [loanLoadError, setLoanLoadError] = useState<string | null>(null);
  const [hasMoreLoans, setHasMoreLoans] = useState(false);
  const [totalLoanCount, setTotalLoanCount] = useState(0);
  const [totalExposurePaise, setTotalExposurePaise] = useState(0);
  const [uncertainLoanCount, setUncertainLoanCount] = useState(0);
  const loanPageRef = useRef(0);

  // Demo Toolbar controls
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [simulatedHour, setSimulatedHour] = useState<number | null>(
    process.env.NODE_ENV === 'production' ? null : 14.5
  );
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [isFlushing, setIsFlushing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Sync count helper
  const updatePendingCount = useCallback(async () => {
    if (!user?.id) return;
    try {
      setPendingSyncCount(await getOfflineQueueCount(user.id));
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Unable to read the offline queue.');
    }
  }, [user?.id]);

  const handleUnlockOfflineVault = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setOfflineUnlockError(null);
    try {
      await unlockOfflineVault(user.id, offlinePassword, confirmLegacyOwnership);
      setOfflineVaultUnlocked(true);
      setOfflinePassword('');
      setConfirmLegacyOwnership(false);
      setLegacyQueueCount(0);
      await updatePendingCount();
    } catch (error) {
      setOfflineUnlockError(error instanceof Error ? error.message : 'Unable to unlock encrypted offline storage.');
    }
  };

  const handleLockOfflineVault = () => {
    lockOfflineVault();
    setOfflineVaultUnlocked(false);
  };

  // Fetch loans from API
  const fetchLoans = useCallback(async (append = false) => {
    try {
      if (append) setIsLoadingMoreLoans(true);
      else setIsLoadingLoans(true);
      const page = append ? loanPageRef.current + 1 : 0;
      const params = new URLSearchParams({ page: page.toString() });
      if (user?.role === 'OFFICER' && user.id) params.set('officerId', user.id);
      const res = await fetch(`/api/loans?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to load the assigned accounts.');
      }
      setLoans((current) => append ? [...current, ...(data.loans || [])] : (data.loans || []));
      setHasMoreLoans(Boolean(data.hasMore));
      setTotalLoanCount(data.totalCount || 0);
      setTotalExposurePaise(data.summary?.totalExposurePaise || 0);
      setUncertainLoanCount(data.summary?.uncertainCount || 0);
      loanPageRef.current = page;
      setLoanLoadError(null);
    } catch (err) {
      setLoanLoadError(err instanceof Error ? err.message : 'Unable to load the assigned accounts.');
    } finally {
      if (append) setIsLoadingMoreLoans(false);
      else setIsLoadingLoans(false);
    }
  }, [user?.id, user?.role]);

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
          setOfflineVaultUser(data.user.id);
          setOfflineVaultUnlocked(isOfflineVaultUnlocked(data.user.id));
        } else {
          if (process.env.NODE_ENV === 'production') {
            router.replace('/login');
            return;
          }
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
            const userId = parsed.userId || parsed.id || 'seed-officer';
            setOfflineVaultUser(userId);
            setOfflineVaultUnlocked(isOfflineVaultUnlocked(userId));
          } else {
            // Default reviewer starting persona: Ramesh Kumar (Field Officer)
            setUser({
              id: 'seed-officer',
              name: 'Ramesh Kumar',
              email: 'officer@msmelender.in',
              role: 'OFFICER',
              assignedPincode: '560058',
            });
            setOfflineVaultUser('seed-officer');
            setOfflineVaultUnlocked(isOfflineVaultUnlocked('seed-officer'));
          }
        }
      } catch {
        if (process.env.NODE_ENV === 'production') {
          router.replace('/login');
          return;
        }
        setUser({
          id: 'seed-officer',
          name: 'Ramesh Kumar',
          email: 'officer@msmelender.in',
          role: 'OFFICER',
          assignedPincode: '560058',
        });
        setOfflineVaultUser('seed-officer');
        setOfflineVaultUnlocked(isOfflineVaultUnlocked('seed-officer'));
      } finally {
        setIsLoadingAuth(false);
      }
    }

    initSession();
  }, [router]);

  useEffect(() => {
    void updatePendingCount();
    void getLegacyOfflineQueueCount().then(setLegacyQueueCount).catch((error: unknown) => {
      setOfflineUnlockError(error instanceof Error ? error.message : 'Unable to inspect offline records.');
    });
  }, [updatePendingCount]);

  useEffect(() => {
    if (!isLoadingAuth) fetchLoans();
  }, [fetchLoans, isLoadingAuth]);

  // Handle Role Switch
  const handleRoleSwitch = (newRole: 'OFFICER' | 'MANAGER') => {
    const userId = newRole === 'OFFICER' ? 'seed-officer' : 'seed-manager';
    setOfflineVaultUser(userId);
    setOfflineVaultUnlocked(isOfflineVaultUnlocked(userId));
    if (newRole === 'OFFICER') {
      setUser({
        id: userId,
        name: 'Ramesh Kumar',
        email: 'officer@msmelender.in',
        role: 'OFFICER',
        assignedPincode: '560058',
      });
    } else {
      setUser({
        id: userId,
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

  useEffect(() => {
    if (isDemoMode || isLoadingAuth) return;
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, [isDemoMode, isLoadingAuth]);

  // Handle RBI Clock Toggle (14:30 vs 20:45)
  const handleToggleRbiClock = () => {
    setSimulatedHour((prev) => (prev === 20.75 ? 14.5 : 20.75));
  };

  // Handle Flush Sync
  const handleFlushSync = async () => {
    setIsFlushing(true);
    setSyncError(null);
    try {
      const result = await flushOfflineQueue(simulatedHour);
      await updatePendingCount();
      if (result.error) {
        setSyncError(result.error);
        alert(`Sync failed: ${result.error}`);
        return;
      }
      await fetchLoans();
      alert(`✅ Batch Sync Complete: ${result.syncedCount} records synced, ${result.duplicateCount} duplicate idempotency receipts verified.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      alert(`Sync failed: ${msg}`);
    } finally {
      setIsFlushing(false);
    }
  };

  useEffect(() => {
    if (isDemoMode || isLoadingAuth || !user?.id || !isOfflineVaultUnlocked(user.id)) return;
    const syncWhenOnline = async () => {
      setIsOnline(true);
      const result = await flushOfflineQueue(null);
      await updatePendingCount();
      if (result.error) {
        setSyncError(result.error);
        return;
      }
      if (result.totalFlushed > 0) {
        setSyncError(null);
        await fetchLoans();
      }
    };
    window.addEventListener('online', syncWhenOnline);
    if (navigator.onLine) void syncWhenOnline();
    return () => window.removeEventListener('online', syncWhenOnline);
  }, [fetchLoans, isDemoMode, isLoadingAuth, updatePendingCount, user?.id, offlineVaultUnlocked]);

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
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      lockOfflineVault();
      localStorage.removeItem('msme_user');
      router.push('/login');
    }
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
        {user?.role === 'OFFICER' && offlineVaultUnlocked && (
          <div className="mx-auto mt-3 max-w-6xl px-4 text-right">
            <button
              type="button"
              onClick={handleLockOfflineVault}
              className="touch-target rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Lock offline records
            </button>
          </div>
        )}
        {syncError && (
          <div role="alert" className="mx-auto mt-3 max-w-6xl px-4">
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              Offline sync is still pending: {syncError}
            </p>
          </div>
        )}
        {user?.role === 'OFFICER' && !offlineVaultUnlocked && (
          <section className="mx-auto mt-3 max-w-6xl px-4" aria-labelledby="offline-vault-title">
            <form
              onSubmit={handleUnlockOfflineVault}
              className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-end"
            >
              <div className="min-w-0 flex-1">
                <h2 id="offline-vault-title" className="text-sm font-bold text-amber-950">
                  Unlock encrypted offline records
                </h2>
                <p className="mt-1 text-xs text-amber-900">
                  Offline visit and contact logs are encrypted on this device. Enter your account password to unlock them; the password is not saved.
                </p>
                {legacyQueueCount > 0 && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-amber-950">
                    <input
                      type="checkbox"
                      checked={confirmLegacyOwnership}
                      onChange={(event) => setConfirmLegacyOwnership(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      {legacyQueueCount} older unencrypted record(s) were found. I am the officer who created them and authorize encrypting them under my account.
                    </span>
                  </label>
                )}
                {offlineUnlockError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{offlineUnlockError}</p>}
              </div>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={offlinePassword}
                onChange={(event) => setOfflinePassword(event.target.value)}
                aria-label="Account password for offline storage"
                placeholder="Account password"
                className="touch-target w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm sm:w-56"
              />
              <button
                type="submit"
                disabled={legacyQueueCount > 0 && !confirmLegacyOwnership}
                className="touch-target rounded-lg bg-amber-900 px-4 py-2 text-sm font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Unlock
              </button>
            </form>
          </section>
        )}
        {loanLoadError && (
          <div role="alert" className="mx-auto mt-3 max-w-6xl px-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <span>{loanLoadError}</span>
              <button
                type="button"
                onClick={() => void fetchLoans()}
                className="touch-target shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-semibold hover:bg-rose-100"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {currentRole === 'OFFICER' ? (
          <FieldOfficerQueue
            loans={loans}
            isOnline={isOnline}
            simulatedHour={simulatedHour}
            language={language}
            onRefreshLoans={fetchLoans}
            hasMoreLoans={hasMoreLoans}
            isLoadingMoreLoans={isLoadingMoreLoans}
            totalLoanCount={totalLoanCount}
            totalExposurePaise={totalExposurePaise}
            uncertainLoanCount={uncertainLoanCount}
            onLoadMoreLoans={() => void fetchLoans(true)}
            onUpdateLoanLocally={handleUpdateLoanLocally}
            onQueueOfflineOutcome={handleQueueOfflineOutcome}
            onContactAttemptQueued={updatePendingCount}
            officerName={user?.name || 'Ramesh Kumar'}
            assignedPincode={user?.assignedPincode || '560058'}
          />
        ) : (
          <ManagerDashboard
            loans={loans}
            onUpdateLoanLocally={handleUpdateLoanLocally}
            onRefreshLoans={fetchLoans}
            hasMoreLoans={hasMoreLoans}
            isLoadingMoreLoans={isLoadingMoreLoans}
            totalLoanCount={totalLoanCount}
            totalExposurePaise={totalExposurePaise}
            uncertainLoanCount={uncertainLoanCount}
            onLoadMoreLoans={() => void fetchLoans(true)}
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
        isDemoMode={isDemoMode}
      />

    </div>
  );
}
