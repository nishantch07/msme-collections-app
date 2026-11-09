import { getIstStartOfToday } from './date';

export interface LoanPriorityInput {
  dpd: number;
  outstanding_paise: number;
  emi_amount_paise: number;
  promises?: Array<{
    status: string; // 'ACTIVE' | 'BROKEN' | 'FULFILLED'
    promise_date: Date | string;
    promised_amount_paise?: number;
  }>;
  recentOutcomes?: Array<{
    outcome_type: string; // 'PAID' | 'PTP' | 'UNREACHABLE' | 'DISPUTE' | 'REFUSED'
    amount_collected_paise?: number | null;
    captured_at_device: Date | string;
    notes?: string;
  }>;
  hasUnresolvedDispute?: boolean;
}

export interface PriorityCalculationResult {
  priorityScore: number;
  dHat: number;
  vHat: number;
  bHat: number;
  topBadges: string[];
  aiConfidence: 'HIGH' | 'LOW_CONFIDENCE' | 'DISPUTE_HOLD';
  aiUncertaintyReason: string | null;
}

/**
 * Deterministic AI Prioritisation Engine for MSME Field Collections
 * Formula: S_i = 0.35 * D_hat + 0.25 * V_hat + 0.25 * B_hat + 0.15 * P_hat
 */
export function calculatePriorityScore(input: LoanPriorityInput): PriorityCalculationResult {
  const { dpd, outstanding_paise, promises = [], recentOutcomes = [], hasUnresolvedDispute = false } = input;

  // 1. D_hat: Normalized DPD capped at 90 days [0 - 100]
  const cappedDpd = Math.max(0, Math.min(dpd, 90));
  const dHat = (cappedDpd / 90) * 100;

  // 2. V_hat: Log-normalized outstanding exposure in paise [0 - 100]
  // Reference range: ₹10,000 (1,000,000 paise) to ₹10,00,000 (100,000,000 paise)
  const minPaise = 1000000;      // ₹10k
  const maxPaise = 100000000;    // ₹10 Lakhs
  const safeOutstanding = Math.max(minPaise, Math.min(outstanding_paise, maxPaise));
  const vHat = ((Math.log(safeOutstanding) - Math.log(minPaise)) / (Math.log(maxPaise) - Math.log(minPaise))) * 100;

  // 3. B_hat: Broken PTP weight with 2x penalty for broken promises in the last 30 days [0 - 100]
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const todayIstStart = getIstStartOfToday(new Date(now)).getTime();

  let weightedBrokenCount = 0;
  let totalBroken = 0;

  for (const p of promises) {
    const pDate = new Date(p.promise_date).getTime();
    const isOverdueActivePromise = p.status === 'ACTIVE'
      && Number.isFinite(pDate)
      && pDate < todayIstStart;
    if (p.status === 'BROKEN' || isOverdueActivePromise) {
      totalBroken++;
      const isWithin30Days = pDate <= now && now - pDate <= thirtyDaysMs;
      weightedBrokenCount += isWithin30Days ? 2.0 : 1.0;
    }
  }

  // Cap broken score at 100 (4 weighted breaks = 100 pts)
  const bHat = Math.min(100, weightedBrokenCount * 25);

  // 4. Recent payment behavior: observed collections reduce priority; no history is neutral.
  const recentOutcomes30d = recentOutcomes.filter((outcome) => {
    const capturedAt = new Date(outcome.captured_at_device).getTime();
    return capturedAt >= now - thirtyDaysMs && capturedAt <= now;
  });
  const recentPaidPaise = recentOutcomes30d
    .filter((outcome) => outcome.outcome_type === 'PAID')
    .reduce((sum, outcome) => sum + (outcome.amount_collected_paise || 0), 0);
  const paymentHat = recentOutcomes30d.length === 0
    ? 50
    : Math.max(0, 100 - Math.min(100, (recentPaidPaise / Math.max(input.emi_amount_paise, 1)) * 100));

  // 5. Composite advisory score with recent payment history included.
  const rawScore = 0.35 * dHat + 0.25 * vHat + 0.25 * bHat + 0.15 * paymentHat;
  const priorityScore = Math.round(rawScore * 10) / 10;

  // 5. Explainability Badges (top 3 human-readable score drivers)
  const dpdPts = (0.35 * dHat).toFixed(1);
  const vPts = (0.25 * vHat).toFixed(1);
  const bPts = (0.25 * bHat).toFixed(1);
  const pPts = (0.15 * paymentHat).toFixed(1);

  const exposureLakhs = (outstanding_paise / 10000000).toFixed(2);

  const topBadges = [
    `${dpd} DPD (+${dpdPts} pts)`,
    totalBroken > 0 
      ? `${totalBroken} Broken PTP${totalBroken > 1 ? 's' : ''} (+${bPts} pts) · payment trend (+${pPts} pts)`
      : `0 Broken PTPs (+${bPts} pts) · payment trend (+${pPts} pts)`,
    `₹${exposureLakhs}L Exposure (+${vPts} pts)`,
  ];

  // 6. Uncertainty Detection & Fallbacks
  // Rule A: Explicit unresolved dispute from outcome logs or flags
  const disputeLogged = hasUnresolvedDispute || recentOutcomes.some((o) => o.outcome_type === 'DISPUTE');

  if (disputeLogged) {
    const disputeNote = recentOutcomes.find((o) => o.outcome_type === 'DISPUTE')?.notes;
    return {
      priorityScore,
      dHat,
      vHat,
      bHat,
      topBadges,
      aiConfidence: 'DISPUTE_HOLD',
      aiUncertaintyReason: disputeNote
        ? `Dispute recorded: "${disputeNote}". Automated recovery escalation suspended pending manager verification.`
        : 'Active borrower dispute flagged (e.g. GST billing or consignment return). Recovery visits frozen for review.',
    };
  }

  // Rule B: Sharp Signal Conflicts
  // Conflict 1: High DPD (>45) but 0 broken PTPs and recent partial payments
  const hasRecentPaidOutcome = recentOutcomes.some(
    (o) => o.outcome_type === 'PAID' && (o.amount_collected_paise || 0) > 0
  );
  if (dpd > 45 && totalBroken === 0 && hasRecentPaidOutcome) {
    return {
      priorityScore,
      dHat,
      vHat,
      bHat,
      topBadges,
      aiConfidence: 'LOW_CONFIDENCE',
      aiUncertaintyReason: `Signal conflict: High DPD (${dpd} days) but zero broken promises and recent partial payment recorded. Automated score may overstate credit risk.`,
    };
  }

  // Conflict 2: High DPD (>60) with no historical visit data or long unvisited gap (>40 days)
  if (dpd > 60 && recentOutcomes.length === 0) {
    return {
      priorityScore,
      dHat,
      vHat,
      bHat,
      topBadges,
      aiConfidence: 'LOW_CONFIDENCE',
      aiUncertaintyReason: `Data sparsity: Account is ${dpd} DPD but lacks recent field visit observations. Prioritisation confidence downgraded for field audit.`,
    };
  }

  // Conflict 3: High DPD (>70) but zero broken PTPs ever
  if (dpd > 70 && totalBroken === 0) {
    return {
      priorityScore,
      dHat,
      vHat,
      bHat,
      topBadges,
      aiConfidence: 'LOW_CONFIDENCE',
      aiUncertaintyReason: `Unusual pattern: Elevated DPD (${dpd}) with zero broken promises on record. Requires manual officer/manager assessment before aggressive routing.`,
    };
  }

  return {
    priorityScore,
    dHat,
    vHat,
    bHat,
    topBadges,
    aiConfidence: 'HIGH',
    aiUncertaintyReason: null,
  };
}
