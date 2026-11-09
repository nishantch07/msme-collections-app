import { openDB, DBSchema } from 'idb';

export interface QueuedOutcome {
  idempotency_key: string;
  loan_id: string;
  borrower_name?: string;
  officer_id?: string;
  outcome_type: 'PAID' | 'PTP' | 'UNREACHABLE' | 'DISPUTE' | 'REFUSED';
  amount_collected_paise?: number | null;
  promised_amount_paise?: number | null;
  promise_date?: string | null;
  notes: string;
  gps_lat: number;
  gps_lng: number;
  gps_accuracy_m: number;
  captured_at_device: string;
}

interface CollectionsDB extends DBSchema {
  outcome_queue: {
    key: string;
    value: QueuedOutcome;
  };
}

const DB_NAME = 'msme_collections_idb';
const DB_VERSION = 1;

async function getDB() {
  if (typeof window === 'undefined') return null;
  return openDB<CollectionsDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('outcome_queue')) {
        db.createObjectStore('outcome_queue', { keyPath: 'idempotency_key' });
      }
    },
  });
}

export async function queueOfflineOutcome(item: QueuedOutcome): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.put('outcome_queue', item);
}

export async function getPendingOfflineOutcomes(): Promise<QueuedOutcome[]> {
  const db = await getDB();
  if (!db) return [];
  return db.getAll('outcome_queue');
}

export async function removePendingOutcome(idempotencyKey: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.delete('outcome_queue', idempotencyKey);
}

export async function clearAllPendingOutcomes(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.clear('outcome_queue');
}

/**
 * Flush all offline items to server batch sync endpoint
 */
export async function flushOfflineQueue(simulatedHour?: number | null): Promise<{
  syncedCount: number;
  duplicateCount: number;
  totalFlushed: number;
  error?: string;
}> {
  const pending = await getPendingOfflineOutcomes();
  if (pending.length === 0) {
    return { syncedCount: 0, duplicateCount: 0, totalFlushed: 0 };
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (simulatedHour !== null && simulatedHour !== undefined) {
      headers['x-simulated-ist-hour'] = simulatedHour.toString();
    }

    const res = await fetch('/api/sync/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ logs: pending }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Batch sync failed');
    }

    const result = await res.json();

    // On successful sync, clear from IndexedDB
    await clearAllPendingOutcomes();

    return {
      syncedCount: result.syncedCount || 0,
      duplicateCount: result.duplicateCount || 0,
      totalFlushed: pending.length,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Network sync error';
    return {
      syncedCount: 0,
      duplicateCount: 0,
      totalFlushed: 0,
      error: message,
    };
  }
}
