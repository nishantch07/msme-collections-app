import { DBSchema, IDBPDatabase, openDB } from 'idb';

export interface QueuedOutcome {
  idempotency_key: string;
  loan_id: string;
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

export interface QueuedContactAttempt {
  idempotency_key: string;
  loan_id: string;
  channel: 'CALL' | 'WHATSAPP';
  officer_id?: string;
  attempted_at_device: string;
  ist_time: string;
  status: 'INITIATED' | 'BLOCKED';
  gps_lat?: number;
  gps_lng?: number;
  details?: string;
}

type QueueKind = 'outcome' | 'contact';

interface EncryptedQueueRecord {
  idempotency_key: string;
  user_id: string;
  version: 1;
  iv: string;
  ciphertext: string;
}

interface CollectionsDB extends DBSchema {
  outcome_queue: {
    key: string;
    value: EncryptedQueueRecord | QueuedOutcome;
  };
  contact_attempt_queue: {
    key: string;
    value: EncryptedQueueRecord | QueuedContactAttempt;
  };
  vault_metadata: {
    key: string;
    value: string;
  };
}

const DB_NAME = 'msme_collections_idb';
const DB_VERSION = 3;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let activeVault: { userId: string; key: CryptoKey } | null = null;
let selectedUserId: string | null = null;
let databasePromise: Promise<IDBPDatabase<CollectionsDB>> | null = null;

async function getDB(): Promise<IDBPDatabase<CollectionsDB>> {
  if (typeof window === 'undefined') throw new Error('Offline storage is unavailable outside a browser.');
  if (!window.crypto?.subtle) throw new Error('This browser does not support encrypted offline storage.');
  if (!databasePromise) {
    databasePromise = openDB<CollectionsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('outcome_queue')) {
          db.createObjectStore('outcome_queue', { keyPath: 'idempotency_key' });
        }
        if (!db.objectStoreNames.contains('contact_attempt_queue')) {
          db.createObjectStore('contact_attempt_queue', { keyPath: 'idempotency_key' });
        }
        if (!db.objectStoreNames.contains('vault_metadata')) {
          db.createObjectStore('vault_metadata');
        }
      },
    }).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function isEncryptedRecord(value: unknown): value is EncryptedQueueRecord {
  return typeof value === 'object'
    && value !== null
    && 'ciphertext' in value
    && 'user_id' in value
    && 'iv' in value;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: 310_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptValue<T extends { idempotency_key: string }>(
  userId: string,
  kind: QueueKind,
  item: T,
  key: CryptoKey
): Promise<EncryptedQueueRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(`${userId}:${kind}:${item.idempotency_key}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(additionalData) },
    key,
    encoder.encode(JSON.stringify(item))
  );
  return {
    idempotency_key: item.idempotency_key,
    user_id: userId,
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptValue<T>(
  userId: string,
  kind: QueueKind,
  record: EncryptedQueueRecord,
  key: CryptoKey
): Promise<T> {
  const additionalData = encoder.encode(`${userId}:${kind}:${record.idempotency_key}`);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64ToBytes(record.iv)),
      additionalData: toArrayBuffer(additionalData),
    },
    key,
    toArrayBuffer(base64ToBytes(record.ciphertext))
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

function requireActiveVault(): { userId: string; key: CryptoKey } {
  if (!activeVault || activeVault.userId !== selectedUserId) {
    throw new Error('Unlock encrypted offline storage with your account password before saving or syncing offline records.');
  }
  return activeVault;
}

export function setOfflineVaultUser(userId: string): void {
  if (selectedUserId !== userId) activeVault = null;
  selectedUserId = userId;
}

export function lockOfflineVault(): void {
  activeVault = null;
}

export function isOfflineVaultUnlocked(userId?: string): boolean {
  return Boolean(activeVault && (!userId || activeVault.userId === userId));
}

async function migrateLegacyRecords(
  db: Awaited<ReturnType<typeof getDB>>,
  userId: string,
  key: CryptoKey
): Promise<void> {
  const stores: Array<{ name: 'outcome_queue' | 'contact_attempt_queue'; kind: QueueKind }> = [
    { name: 'outcome_queue', kind: 'outcome' },
    { name: 'contact_attempt_queue', kind: 'contact' },
  ];

  for (const store of stores) {
    const records = await db.getAll(store.name);
    for (const record of records) {
      if (isEncryptedRecord(record)) continue;
      const encrypted = await encryptValue(userId, store.kind, record, key);
      await db.put(store.name, encrypted);
    }
  }
}

export async function getLegacyOfflineQueueCount(): Promise<number> {
  const db = await getDB();
  const [outcomes, contacts] = await Promise.all([
    db.getAll('outcome_queue'),
    db.getAll('contact_attempt_queue'),
  ]);
  return [...outcomes, ...contacts].filter((record) => !isEncryptedRecord(record)).length;
}

export async function unlockOfflineVault(
  userId: string,
  password: string,
  confirmLegacyOwnership = false
): Promise<void> {
  if (!userId) throw new Error('A signed-in account is required to unlock offline storage.');
  activeVault = null;
  selectedUserId = userId;
  if (password.length < 12 && process.env.NODE_ENV === 'production') {
    throw new Error('Offline storage requires an account password of at least 12 characters.');
  }

  const db = await getDB();
  const [outcomes, contacts] = await Promise.all([
    db.getAll('outcome_queue'),
    db.getAll('contact_attempt_queue'),
  ]);
  const hasLegacyRecords = [...outcomes, ...contacts].some((record) => !isEncryptedRecord(record));
  if (hasLegacyRecords && !confirmLegacyOwnership) {
    throw new Error('Unencrypted records from an earlier version were found. Confirm that you are the officer who created them before upgrading them to encrypted storage.');
  }

  const saltKey = `salt:${userId}`;
  let encodedSalt = await db.get('vault_metadata', saltKey);
  if (!encodedSalt) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    encodedSalt = bytesToBase64(salt);
    await db.put('vault_metadata', encodedSalt, saltKey);
  }

  const key = await deriveKey(password, base64ToBytes(encodedSalt));
  const checkKey = `check:${userId}`;
  const encryptedCheck = await db.get('vault_metadata', checkKey);
  if (encryptedCheck) {
    try {
      const check = await decryptValue<{ value: string }>(
        userId,
        'outcome',
        JSON.parse(encryptedCheck) as EncryptedQueueRecord,
        key
      );
      if (check.value !== 'MSME_OFFLINE_VAULT_V1') throw new Error('Incorrect password.');
    } catch {
      throw new Error('Unable to unlock offline storage. Check your password and try again.');
    }
  } else {
    const verifier = await encryptValue(
      userId,
      'outcome',
      { idempotency_key: '__vault_check__', value: 'MSME_OFFLINE_VAULT_V1' },
      key
    );
    await db.put('vault_metadata', JSON.stringify(verifier), checkKey);
  }

  selectedUserId = userId;
  activeVault = { userId, key };
  await migrateLegacyRecords(db, userId, key);
}

export async function getOfflineQueueCount(userId: string): Promise<number> {
  const db = await getDB();
  const [outcomes, contacts] = await Promise.all([
    db.getAll('outcome_queue'),
    db.getAll('contact_attempt_queue'),
  ]);
  return [...outcomes, ...contacts].filter(
    (record) => !isEncryptedRecord(record) || record.user_id === userId
  ).length;
}

export async function queueOfflineOutcome(item: QueuedOutcome): Promise<void> {
  const vault = requireActiveVault();
  const db = await getDB();
  await db.put('outcome_queue', await encryptValue(vault.userId, 'outcome', item, vault.key));
}

export async function getPendingOfflineOutcomes(): Promise<QueuedOutcome[]> {
  const vault = requireActiveVault();
  const db = await getDB();
  const records = await db.getAll('outcome_queue');
  return Promise.all(
    records
      .filter(isEncryptedRecord)
      .filter((record) => record.user_id === vault.userId)
      .map((record) => decryptValue<QueuedOutcome>(vault.userId, 'outcome', record, vault.key))
  );
}

export async function removePendingOutcome(idempotencyKey: string): Promise<void> {
  const db = await getDB();
  await db.delete('outcome_queue', idempotencyKey);
}

export async function clearAllPendingOutcomes(): Promise<void> {
  const db = await getDB();
  const vault = requireActiveVault();
  const records = await db.getAll('outcome_queue');
  const tx = db.transaction('outcome_queue', 'readwrite');
  for (const record of records) {
    if (isEncryptedRecord(record) && record.user_id === vault.userId) {
      await tx.store.delete(record.idempotency_key);
    }
  }
  await tx.done;
}

export async function queueOfflineContactAttempt(item: QueuedContactAttempt): Promise<void> {
  const vault = requireActiveVault();
  const db = await getDB();
  await db.put('contact_attempt_queue', await encryptValue(vault.userId, 'contact', item, vault.key));
}

export async function getPendingOfflineContactAttempts(): Promise<QueuedContactAttempt[]> {
  const vault = requireActiveVault();
  const db = await getDB();
  const records = await db.getAll('contact_attempt_queue');
  return Promise.all(
    records
      .filter(isEncryptedRecord)
      .filter((record) => record.user_id === vault.userId)
      .map((record) => decryptValue<QueuedContactAttempt>(vault.userId, 'contact', record, vault.key))
  );
}

export async function flushOfflineQueue(simulatedHour?: number | null): Promise<{
  syncedCount: number;
  duplicateCount: number;
  totalFlushed: number;
  error?: string;
}> {
  const pending = await getPendingOfflineOutcomes();
  const pendingContacts = await getPendingOfflineContactAttempts();
  if (pending.length === 0 && pendingContacts.length === 0) {
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
      body: JSON.stringify({ logs: pending, contact_attempts: pendingContacts }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || err.error || 'Batch sync failed');
    }

    const result = await res.json();
    const receipts: Array<{ idempotency_key: string; status: string }> = result.receipts || [];
    const acceptedStatuses = new Set([
      'SYNCED',
      'CONTACT_RECORDED',
      'DUPLICATE_ALREADY_SYNCED',
      'DUPLICATE_INTRA_BATCH',
    ]);
    const db = await getDB();
    const tx = db.transaction(['outcome_queue', 'contact_attempt_queue'], 'readwrite');
    for (const receipt of receipts) {
      if (!acceptedStatuses.has(receipt.status)) continue;
      await tx.objectStore('outcome_queue').delete(receipt.idempotency_key);
      await tx.objectStore('contact_attempt_queue').delete(receipt.idempotency_key);
    }
    await tx.done;

    const rejectedCount = receipts.filter((receipt) => !acceptedStatuses.has(receipt.status)).length;
    return {
      syncedCount: result.syncedCount || 0,
      duplicateCount: result.duplicateCount || 0,
      totalFlushed: pending.length + pendingContacts.length,
      ...(rejectedCount > 0
        ? { error: `${rejectedCount} queued record(s) were rejected and remain encrypted on this device for review.` }
        : {}),
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
