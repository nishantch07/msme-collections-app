import { describe, it, expect } from 'vitest';
import { calculatePriorityScore } from '../src/lib/priority-engine';
import { checkRbiCompliance } from '../src/lib/compliance';
import {
  validateCommunicationGuardrails,
  getDltTemplateReminder,
} from '../src/lib/ai-guardrails';

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
