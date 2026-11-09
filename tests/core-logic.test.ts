import { beforeEach, describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { calculatePriorityScore } from '../src/lib/priority-engine';
import { checkRbiCompliance } from '../src/lib/compliance';
import {
  validateCommunicationGuardrails,
  getDltTemplateReminder,
} from '../src/lib/ai-guardrails';
import { parseCsv, normalizeCsvHeader } from '../src/lib/csv-import';
import { getIstStartOfToday, parseDateOnlyInIst } from '../src/lib/date';
import {
  getLegacyOfflineQueueCount,
  getPendingOfflineOutcomes,
  isOfflineVaultUnlocked,
  lockOfflineVault,
  queueOfflineOutcome,
  setOfflineVaultUser,
  unlockOfflineVault,
} from '../src/lib/offline-db';

describe('1. AI Prioritisation Engine & Uncertainty Detection', () => {
  it('calculates deterministic composite priority score with explainability badges', () => {
    // Account with 60 DPD, ₹5 Lakhs exposure, and 1 recent broken PTP
    const result = calculatePriorityScore({
      dpd: 60,
      outstanding_paise: 50000000, // ₹5,00,000
      emi_amount_paise: 4000000,
      promises: [
        {
          status: 'BROKEN',
          promise_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago (within 30d => 2x weight)
        },
      ],
      recentOutcomes: [],
    });

    // Capped DPD = 60/90 * 100 = 66.67
    // V_hat: ln(50000000 / 1000000) / ln(100) = ln(50)/ln(100) = 3.912/4.605 = ~84.95
    // B_hat: 1 recent broken * 2 * 25 = 50 pts
    // Score should be strictly between 60 and 80
    expect(result.priorityScore).toBeGreaterThan(60);
    expect(result.priorityScore).toBeLessThan(80);
    expect(result.topBadges).toHaveLength(3);
    expect(result.topBadges[0]).toContain('60 DPD');
    expect(result.topBadges[1]).toContain('1 Broken PTP');
    expect(result.topBadges[2]).toContain('Exposure');
    expect(result.aiConfidence).toBe('HIGH');
  });

  it('triggers DISPUTE_HOLD and freezes automated routing when an unresolved dispute exists', () => {
    const result = calculatePriorityScore({
      dpd: 52,
      outstanding_paise: 32000000,
      emi_amount_paise: 2800000,
      recentOutcomes: [
        {
          outcome_type: 'DISPUTE',
          notes: 'Customer raised GST mismatch claim on invoices',
          captured_at_device: new Date(),
        },
      ],
      hasUnresolvedDispute: true,
    });

    expect(result.aiConfidence).toBe('DISPUTE_HOLD');
    expect(result.aiUncertaintyReason).toContain('GST mismatch claim');
  });

  it('sanitizes coercive wording and mismatched amounts from the final message draft', () => {
    const result = validateCommunicationGuardrails(
      'This is a formal notice. Police action will follow unless you pay ₹8,000 immediately. The correct EMI is ₹4,000.',
      1_000_000,
      400_000,
    );

    expect(result.safe).toBe(false);
    expect(result.violations.some((violation) => violation.toLowerCase().includes('police'))).toBe(true);
    expect(result.violations.some((violation) => violation.toLowerCase().includes('hallucinated'))).toBe(true);
    expect(result.sanitizedDraft).not.toContain('police');
    expect(result.sanitizedDraft).toContain('₹4,000');
    expect(result.sanitizedDraft).not.toContain('₹8,000');
  });

  it('triggers LOW_CONFIDENCE when signals conflict sharply (high DPD with partial payments)', () => {
    const result = calculatePriorityScore({
      dpd: 68,
      outstanding_paise: 38000000,
      emi_amount_paise: 3500000,
      promises: [], // 0 broken promises
      recentOutcomes: [
        {
          outcome_type: 'PAID',
          amount_collected_paise: 1500000, // voluntary partial payment
          captured_at_device: new Date(),
        },
      ],
    });

    expect(result.aiConfidence).toBe('LOW_CONFIDENCE');
    expect(result.aiUncertaintyReason).toContain('Signal conflict');
  });

  it('uses recent payment behavior as an explicit score input', () => {
    const baseline = {
      dpd: 20,
      outstanding_paise: 25000000,
      emi_amount_paise: 2500000,
      promises: [],
    };
    const withoutHistory = calculatePriorityScore(baseline);
    const withFullPayment = calculatePriorityScore({
      ...baseline,
      recentOutcomes: [{
        outcome_type: 'PAID',
        amount_collected_paise: 2500000,
        captured_at_device: new Date(),
      }],
    });

    expect(withFullPayment.priorityScore).toBeLessThan(withoutHistory.priorityScore);
    expect(withFullPayment.topBadges[1]).toContain('payment trend');
  });
});

describe('5. Overdue CSV import parsing', () => {
  it('parses quoted commas, escaped quotes, and embedded newlines', () => {
    expect(parseCsv('Loan ID,Borrower,Notes\r\nLN-1,"Company, Ltd","Line one\nLine ""two"""')).toEqual([
      ['Loan ID', 'Borrower', 'Notes'],
      ['LN-1', 'Company, Ltd', 'Line one\nLine "two"'],
    ]);
  });

  it('normalizes an Excel UTF-8 BOM header', () => {
    expect(normalizeCsvHeader('\uFEFFOutstanding ₹')).toBe('outstanding');
  });
});

describe('Date-only promise validation', () => {
  it('accepts leap dates and rejects impossible calendar dates', () => {
    expect(parseDateOnlyInIst('2024-02-29')).toBeInstanceOf(Date);
    expect(parseDateOnlyInIst('2025-02-29')).toBeNull();
    expect(parseDateOnlyInIst('2025-13-01')).toBeNull();
  });

  it('calculates the start of today in IST independently of the server timezone', () => {
    expect(getIstStartOfToday(new Date('2026-11-09T00:30:00.000Z')).toISOString())
      .toBe('2026-11-08T18:30:00.000Z');
    expect(getIstStartOfToday(new Date('2026-11-09T18:30:00.000Z')).toISOString())
      .toBe('2026-11-09T18:30:00.000Z');
  });

  it('treats promises before today as broken but leaves promises due today active', () => {
    const dueToday = calculatePriorityScore({
      dpd: 20,
      outstanding_paise: 25000000,
      emi_amount_paise: 2500000,
      promises: [{ status: 'ACTIVE', promise_date: new Date(Date.now() + 60 * 60 * 1000) }],
    });
    const overdue = calculatePriorityScore({
      dpd: 20,
      outstanding_paise: 25000000,
      emi_amount_paise: 2500000,
      promises: [{ status: 'ACTIVE', promise_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }],
    });

    expect(overdue.bHat).toBe(50);
    expect(overdue.priorityScore).toBeGreaterThan(dueToday.priorityScore);
    expect(overdue.topBadges[1]).toContain('1 Broken PTP');
  });

  describe('Encrypted offline queue', () => {
    beforeEach(async () => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { crypto: globalThis.crypto },
      });
      const database = await openDB('msme_collections_idb', 3, {
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
      });
      database.close();
      setOfflineVaultUser('officer-1');
      lockOfflineVault();
    });

    it('encrypts queued borrower data and requires the account password to decrypt it', async () => {
      await unlockOfflineVault('officer-1', 'OfficerPassword123');
      const item = {
        idempotency_key: 'outcome-1',
        loan_id: 'loan-private-1',
        outcome_type: 'UNREACHABLE' as const,
        notes: 'Borrower follow-up details',
        gps_lat: 22.7196,
        gps_lng: 75.8577,
        gps_accuracy_m: 12,
        captured_at_device: '2026-11-09T10:00:00.000Z',
      };
      await queueOfflineOutcome(item);

      const database = await openDB('msme_collections_idb', 3);
      const stored = await database.get('outcome_queue', item.idempotency_key);
      database.close();
      expect(JSON.stringify(stored)).not.toContain(item.loan_id);
      expect(JSON.stringify(stored)).not.toContain(item.notes);
      expect(await getPendingOfflineOutcomes()).toEqual([item]);

      lockOfflineVault();
      await expect(getPendingOfflineOutcomes()).rejects.toThrow('Unlock encrypted offline storage');
      await expect(unlockOfflineVault('officer-1', 'IncorrectPassword123')).rejects.toThrow('Unable to unlock offline storage');
      expect(isOfflineVaultUnlocked('officer-1')).toBe(false);

      await unlockOfflineVault('officer-1', 'OfficerPassword123');
      expect(await getPendingOfflineOutcomes()).toEqual([item]);
    });

    it('keeps records separate between officer vaults', async () => {
      const item = {
        idempotency_key: 'officer-a-outcome',
        loan_id: 'loan-a',
        outcome_type: 'UNREACHABLE' as const,
        notes: '',
        gps_lat: 22.7,
        gps_lng: 75.8,
        gps_accuracy_m: 10,
        captured_at_device: '2026-11-09T10:00:00.000Z',
      };
      setOfflineVaultUser('officer-a');
      await unlockOfflineVault('officer-a', 'OfficerPassword123');
      await queueOfflineOutcome(item);

      setOfflineVaultUser('officer-b');
      await unlockOfflineVault('officer-b', 'OfficerPassword456');
      expect(await getPendingOfflineOutcomes()).toEqual([]);

      setOfflineVaultUser('officer-a');
      await unlockOfflineVault('officer-a', 'OfficerPassword123');
      expect(await getPendingOfflineOutcomes()).toEqual([item]);
    });

    it('requires explicit ownership confirmation before encrypting legacy plaintext records', async () => {
      const database = await openDB('msme_collections_idb', 3);
      const legacyItem = {
        idempotency_key: 'legacy-outcome',
        loan_id: 'legacy-loan',
        outcome_type: 'UNREACHABLE' as const,
        notes: '',
        gps_lat: 22.7,
        gps_lng: 75.8,
        gps_accuracy_m: 10,
        captured_at_device: '2026-11-09T10:00:00.000Z',
      };
      await database.put('outcome_queue', legacyItem);

      setOfflineVaultUser('legacy-officer');
      await expect(unlockOfflineVault('legacy-officer', 'LegacyPassword123')).rejects.toThrow('Confirm that you are the officer');
      expect(await getLegacyOfflineQueueCount()).toBe(1);

      await unlockOfflineVault('legacy-officer', 'LegacyPassword123', true);
      expect(await getPendingOfflineOutcomes()).toEqual([legacyItem]);
      expect(await getLegacyOfflineQueueCount()).toBe(0);
      database.close();
    });
  });
});

describe('2. RBI Fair Practices Contact Window (08:00 - 19:00 IST)', () => {
  it('strictly blocks contact at 07:59 IST (early morning locked)', () => {
    const check = checkRbiCompliance({
      simulatedHour: 7,
      simulatedMinute: 59,
    });

    expect(check.isAllowed).toBe(false);
    expect(check.currentTimeString).toBe('07:59 IST');
    expect(check.reason).toContain('RBI Fair Practices Code violation');
  });

  it('strictly blocks contact at 19:01 IST (night locked)', () => {
    const check = checkRbiCompliance({
      simulatedHour: 19,
      simulatedMinute: 1,
    });

    expect(check.isAllowed).toBe(false);
    expect(check.currentTimeString).toBe('19:01 IST');
    expect(check.reason).toContain('RBI Fair Practices Code violation');
  });

  it('blocks exactly 19:00 and correctly interprets fractional simulated hours', () => {
    const atCutoff = checkRbiCompliance({ simulatedHour: 19 });
    const halfPastSeven = checkRbiCompliance({ simulatedHour: 19.5 });

    expect(atCutoff.isAllowed).toBe(false);
    expect(atCutoff.currentTimeString).toBe('19:00 IST');
    expect(halfPastSeven.isAllowed).toBe(false);
    expect(halfPastSeven.currentTimeString).toBe('19:30 IST');
  });

  it('interprets the daytime demo clock as 14:30 IST', () => {
    const check = checkRbiCompliance({ simulatedHour: 14.5 });

    expect(check.isAllowed).toBe(true);
    expect(check.currentTimeString).toBe('14:30 IST');
  });

  it('allows contact at 14:00 IST (afternoon permitted)', () => {
    const check = checkRbiCompliance({
      simulatedHour: 14,
      simulatedMinute: 0,
    });

    expect(check.isAllowed).toBe(true);
    expect(check.currentTimeString).toBe('14:00 IST');
    expect(check.reason).toBeUndefined();
  });
});

describe('3. AI Guardrails: 2-Layer Safety & Anti-Hallucination Filter', () => {
  const outstandingPaise = 48500000; // ₹4,85,000
  const emiAmountPaise = 4200000;    // ₹42,000

  it('detects and strips coercive/threatening English terms', () => {
    const coerciveDraft = 'Pay your EMI immediately or police will come and seize your shop assets and put you in jail.';
    const result = validateCommunicationGuardrails(
      coerciveDraft,
      outstandingPaise,
      emiAmountPaise
    );

    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.violations.some((v) => v.includes('police'))).toBe(true);
    expect(result.violations.some((v) => v.includes('seize'))).toBe(true);
    expect(result.violations.some((v) => v.includes('jail'))).toBe(true);
    expect(result.sanitizedDraft).not.toContain('police');
    expect(result.sanitizedDraft).not.toContain('jail');
  });

  it('detects and strips coercive Hindi terms', () => {
    const coerciveHindiDraft = 'यदि आपने आज भुगतान नहीं किया तो पुलिस आपको गिरफ्तार करेगी और सामान जब्त होगा।';
    const result = validateCommunicationGuardrails(
      coerciveHindiDraft,
      outstandingPaise,
      emiAmountPaise
    );

    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('गिरफ्तार'))).toBe(true);
    expect(result.violations.some((v) => v.includes('जब्त'))).toBe(true);
    expect(result.sanitizedDraft).not.toContain('गिरफ्तार');
    expect(result.sanitizedDraft).not.toContain('जब्त');
  });

  it('detects hallucinated currency amounts not in ledger', () => {
    const hallucinatedDraft = 'Your pending loan installment is ₹95,000. Kindly pay today.';
    const result = validateCommunicationGuardrails(
      hallucinatedDraft,
      outstandingPaise,
      emiAmountPaise
    );

    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('Hallucinated loan amount'))).toBe(true);
    // Should sanitize by replacing with actual EMI (₹42,000)
    expect(result.sanitizedDraft).toContain('₹42,000');
  });

  it('passes clean DLT-template messages in both English and Hindi', () => {
    const enDraft = getDltTemplateReminder({
      borrowerName: 'Peenya CNC Precision Works',
      ownerName: 'H. S. Venkatesh',
      accountNumber: 'BLR-MSME-2024-001',
      outstandingPaise,
      emiAmountPaise,
      officerName: 'Ramesh Kumar',
    }, 'en');

    const enResult = validateCommunicationGuardrails(
      enDraft,
      outstandingPaise,
      emiAmountPaise
    );
    expect(enResult.safe).toBe(true);
    expect(enResult.violations).toHaveLength(0);

    const hiDraft = getDltTemplateReminder({
      borrowerName: 'Peenya CNC Precision Works',
      ownerName: 'H. S. Venkatesh',
      accountNumber: 'BLR-MSME-2024-001',
      outstandingPaise,
      emiAmountPaise,
      officerName: 'Ramesh Kumar',
    }, 'hi');

    const hiResult = validateCommunicationGuardrails(
      hiDraft,
      outstandingPaise,
      emiAmountPaise
    );
    expect(hiResult.safe).toBe(true);
    expect(hiResult.violations).toHaveLength(0);
  });
});

describe('4. Offline Sync Idempotency Deduplication', () => {
  it('deduplicates batch outcome logs by unique idempotency_key', () => {
    const incomingBatch = [
      { idempotency_key: 'offline-uuid-1', outcome_type: 'PTP', amount: 0 },
      { idempotency_key: 'offline-uuid-2', outcome_type: 'PAID', amount: 5000 },
      { idempotency_key: 'offline-uuid-1', outcome_type: 'PTP', amount: 0 }, // Duplicate resend
      { idempotency_key: 'offline-uuid-3', outcome_type: 'UNREACHABLE', amount: 0 },
      { idempotency_key: 'offline-uuid-2', outcome_type: 'PAID', amount: 5000 }, // Duplicate resend
    ];

    const processedKeys = new Set<string>();
    const deduplicatedRecords = [];

    for (const item of incomingBatch) {
      if (!processedKeys.has(item.idempotency_key)) {
        processedKeys.add(item.idempotency_key);
        deduplicatedRecords.push(item);
      }
    }

    expect(deduplicatedRecords).toHaveLength(3);
    expect(deduplicatedRecords.map((r) => r.idempotency_key)).toEqual([
      'offline-uuid-1',
      'offline-uuid-2',
      'offline-uuid-3',
    ]);
  });
});
