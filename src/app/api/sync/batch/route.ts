import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { calculatePriorityScore } from '@/lib/priority-engine';
import { checkRbiCompliance } from '@/lib/compliance';
import { parseDateOnlyInIst } from '@/lib/date';
import { enforceRateLimit } from '@/lib/rate-limit';
import { hashOutcomePayload } from '@/lib/idempotency';
import { requireProductionDataUseApproval } from '@/lib/production-readiness';

const SyncBatchItemSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  loan_id: z.string().min(1),
  officer_id: z.string().optional(),
  outcome_type: z.enum(['PAID', 'PTP', 'UNREACHABLE', 'DISPUTE', 'REFUSED']),
  amount_collected_paise: z.number().int().positive().optional().nullable(),
  promised_amount_paise: z.number().int().positive().optional().nullable(),
  promise_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(1000).default(''),
  gps_lat: z.number().min(-90).max(90),
  gps_lng: z.number().min(-180).max(180),
  gps_accuracy_m: z.number().positive().max(100000),
  captured_at_device: z.string().datetime(),
}).superRefine((item, context) => {
  if (item.outcome_type === 'PAID' && !item.amount_collected_paise) {
    context.addIssue({ code: 'custom', path: ['amount_collected_paise'], message: 'A paid outcome requires an amount.' });
  }
  if (item.outcome_type === 'PTP' && (!item.promised_amount_paise || !item.promise_date)) {
    context.addIssue({ code: 'custom', path: ['promise_date'], message: 'A promise amount and date are required.' });
  }
  if (item.promise_date && !parseDateOnlyInIst(item.promise_date)) {
    context.addIssue({ code: 'custom', path: ['promise_date'], message: 'Enter a valid promise date.' });
  }
});

const SyncContactAttemptSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  loan_id: z.string().min(1),
  officer_id: z.string().optional(),
  channel: z.enum(['CALL', 'WHATSAPP']),
  status: z.enum(['INITIATED', 'BLOCKED']),
  attempted_at_device: z.string().datetime(),
  ist_time: z.string().max(32),
  gps_lat: z.number().min(-90).max(90).optional(),
  gps_lng: z.number().min(-180).max(180).optional(),
  details: z.string().max(1000).optional(),
}).superRefine((attempt, context) => {
  if ((attempt.gps_lat === undefined) !== (attempt.gps_lng === undefined)) {
    context.addIssue({ code: 'custom', path: ['gps_lat'], message: 'Contact GPS must include both coordinates.' });
  }
});

const BatchSchema = z.object({
  logs: z.array(SyncBatchItemSchema).max(500).default([]),
  contact_attempts: z.array(SyncContactAttemptSchema).max(500).default([]),
});

export async function POST(req: Request) {
  try {
    const session = await getCurrentUserFromHeadersOrCookies(req);
    if (process.env.NODE_ENV === 'production' && !session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (session && session.role !== 'OFFICER') {
      return NextResponse.json({ error: 'Field officer role required.' }, { status: 403 });
    }
    const rateLimitResponse = await enforceRateLimit(req, 'sync');
    if (rateLimitResponse) return rateLimitResponse;
    const releaseGateResponse = await requireProductionDataUseApproval();
    if (releaseGateResponse) return releaseGateResponse;

    let defaultOfficerId = session?.userId;
    if (!defaultOfficerId) {
      const defaultOfficer = await prisma.user.findFirst({ where: { role: 'OFFICER' } });
      defaultOfficerId = defaultOfficer?.id;
    }
    if (!defaultOfficerId) {
      return NextResponse.json({ error: 'No field officer is available to receive offline records.' }, { status: 503 });
    }

    const body = await req.json();
    const parseResult = BatchSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid batch sync format', details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { logs, contact_attempts: contactAttempts } = parseResult.data;
    const receipts: Array<{ idempotency_key: string; status: string; id?: string }> = [];
    let syncedCount = 0;
    let duplicateCount = 0;
    const seenContactKeys = new Set<string>();

    for (const attempt of contactAttempts) {
      if (seenContactKeys.has(attempt.idempotency_key)) {
        duplicateCount += 1;
        receipts.push({ idempotency_key: attempt.idempotency_key, status: 'DUPLICATE_INTRA_BATCH' });
        continue;
      }
      seenContactKeys.add(attempt.idempotency_key);
      const existing = await prisma.contactAttempt.findUnique({
        where: { idempotency_key: attempt.idempotency_key },
      });
      if (existing) {
        duplicateCount += 1;
        receipts.push({ idempotency_key: attempt.idempotency_key, status: 'DUPLICATE_ALREADY_SYNCED', id: existing.id });
        continue;
      }

      const loan = await prisma.loan.findUnique({ where: { id: attempt.loan_id } });
      if (!loan) {
        receipts.push({ idempotency_key: attempt.idempotency_key, status: 'ERROR_LOAN_NOT_FOUND' });
        continue;
      }
      if (session?.role === 'OFFICER' && loan.assigned_officer_id !== session.userId) {
        receipts.push({ idempotency_key: attempt.idempotency_key, status: 'ERROR_NOT_ASSIGNED' });
        continue;
      }

      const attemptedAt = new Date(attempt.attempted_at_device);
      if (Number.isNaN(attemptedAt.getTime())) {
        receipts.push({ idempotency_key: attempt.idempotency_key, status: 'ERROR_INVALID_DEVICE_TIME' });
        continue;
      }
      if (attemptedAt.getTime() > Date.now() + 5 * 60 * 1000) {
        receipts.push({ idempotency_key: attempt.idempotency_key, status: 'ERROR_FUTURE_DEVICE_TIME' });
        continue;
      }
      const compliance = checkRbiCompliance({ date: attemptedAt });
      const productionOfflineContactBlocked = process.env.NODE_ENV === 'production';
      const status = attempt.status === 'BLOCKED' || !compliance.isAllowed || productionOfflineContactBlocked
        ? 'BLOCKED'
        : 'INITIATED';
      const created = await prisma.contactAttempt.create({
        data: {
          idempotency_key: attempt.idempotency_key,
          loan_id: attempt.loan_id,
          officer_id: session?.userId || defaultOfficerId,
          channel: attempt.channel,
          status,
          attempted_at: attemptedAt,
          ist_time: compliance.currentTimeString,
          gps_lat: attempt.gps_lat,
          gps_lng: attempt.gps_lng,
          details: productionOfflineContactBlocked
            ? attempt.channel === 'WHATSAPP'
              ? 'Production messaging is blocked until an approved template and sending integration are implemented.'
              : 'Offline contact attempts cannot be marked initiated because the server-controlled contact window could not be verified at the time.'
            : attempt.details || (status === 'BLOCKED' ? compliance.reason : null),
        },
      });
      receipts.push({ idempotency_key: attempt.idempotency_key, status: 'CONTACT_RECORDED', id: created.id });
      syncedCount += 1;
    }

    // Track keys in current batch
    const seenBatchKeys = new Set<string>();

    for (const item of logs) {
      // Intra-batch duplicate check
      if (seenBatchKeys.has(item.idempotency_key)) {
        duplicateCount++;
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'DUPLICATE_INTRA_BATCH',
        });
        continue;
      }
      seenBatchKeys.add(item.idempotency_key);

      // Database duplicate check
      const officerId = session?.userId || defaultOfficerId;
      const payloadHash = hashOutcomePayload({ ...item, officer_id: officerId });
      const existing = await prisma.outcomeLog.findUnique({
        where: { idempotency_key: item.idempotency_key },
        select: {
          id: true,
          loan_id: true,
          officer_id: true,
          payload_hash: true,
          outcome_type: true,
          amount_collected_paise: true,
          notes: true,
          gps_lat: true,
          gps_lng: true,
          gps_accuracy_m: true,
        },
      });

      if (existing) {
        const samePayload = existing.payload_hash
          ? existing.payload_hash === payloadHash
          : existing.loan_id === item.loan_id
            && existing.officer_id === officerId
            && existing.outcome_type === item.outcome_type
            && existing.amount_collected_paise === (item.amount_collected_paise ?? null)
            && existing.notes === item.notes
            && existing.gps_lat === item.gps_lat
            && existing.gps_lng === item.gps_lng
            && existing.gps_accuracy_m === item.gps_accuracy_m;
        if (samePayload) {
          duplicateCount++;
          receipts.push({
            idempotency_key: item.idempotency_key,
            status: 'DUPLICATE_ALREADY_SYNCED',
            id: existing.id,
          });
        } else {
          receipts.push({
            idempotency_key: item.idempotency_key,
            status: 'ERROR_IDEMPOTENCY_CONFLICT',
          });
        }
        continue;
      }

      // Verify Loan
      const loan = await prisma.loan.findUnique({
        where: { id: item.loan_id },
      });

      if (!loan) {
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'ERROR_LOAN_NOT_FOUND',
        });
        continue;
      }
      if (session?.role === 'OFFICER' && loan.assigned_officer_id !== session.userId) {
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'ERROR_NOT_ASSIGNED',
        });
        continue;
      }

      const capturedAt = new Date(item.captured_at_device);
      if (Number.isNaN(capturedAt.getTime())) {
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'ERROR_INVALID_DEVICE_TIME',
        });
        continue;
      }
      if (capturedAt.getTime() > Date.now() + 5 * 60 * 1000) {
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'ERROR_FUTURE_DEVICE_TIME',
        });
        continue;
      }
      const compliance = checkRbiCompliance({ date: capturedAt });
      if (!compliance.isAllowed) {
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'ERROR_COMPLIANCE_WINDOW',
        });
        continue;
      }
      if (item.outcome_type === 'PAID' && (item.amount_collected_paise || 0) > loan.outstanding_paise) {
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'ERROR_PAYMENT_EXCEEDS_BALANCE',
        });
        continue;
      }
      const promiseDate = item.promise_date ? parseDateOnlyInIst(item.promise_date) : null;
      if (item.outcome_type === 'PTP' && !promiseDate) {
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'ERROR_INVALID_PROMISE_DATE',
        });
        continue;
      }

      const applied = await prisma.$transaction(async (transaction) => {
        const currentLoan = await transaction.loan.findUnique({ where: { id: item.loan_id } });
        if (!currentLoan) return { type: 'not-found' as const };
        if (session?.role === 'OFFICER' && currentLoan.assigned_officer_id !== session.userId) {
          return { type: 'not-assigned' as const };
        }

        const concurrentDuplicate = await transaction.outcomeLog.findUnique({
          where: { idempotency_key: item.idempotency_key },
          select: { id: true, payload_hash: true },
        });
        if (concurrentDuplicate) {
          return concurrentDuplicate.payload_hash === payloadHash
            ? { type: 'duplicate' as const, id: concurrentDuplicate.id }
            : { type: 'conflict' as const };
        }

        if (item.outcome_type === 'PAID') {
          const paymentUpdate = await transaction.loan.updateMany({
            where: {
              id: item.loan_id,
              outstanding_paise: { gte: item.amount_collected_paise || 0 },
            },
            data: { outstanding_paise: { decrement: item.amount_collected_paise || 0 } },
          });
          if (paymentUpdate.count !== 1) return { type: 'payment-exceeds-balance' as const };
        }

        const loanAfterPayment = item.outcome_type === 'PAID'
          ? await transaction.loan.findUnique({ where: { id: item.loan_id } })
          : currentLoan;
        if (!loanAfterPayment) return { type: 'not-found' as const };

        const createdLog = await transaction.outcomeLog.create({
          data: {
            idempotency_key: item.idempotency_key,
            payload_hash: payloadHash,
            loan_id: item.loan_id,
            officer_id: officerId,
            outcome_type: item.outcome_type,
            amount_collected_paise: item.amount_collected_paise || null,
            notes: item.notes,
            gps_lat: item.gps_lat,
            gps_lng: item.gps_lng,
            gps_accuracy_m: item.gps_accuracy_m,
            captured_at_device: capturedAt,
          },
        });

        if (item.outcome_type === 'PTP' && item.promised_amount_paise && promiseDate) {
          await transaction.promiseToPay.create({
            data: {
              loan_id: item.loan_id,
              promised_amount_paise: item.promised_amount_paise,
              promise_date: promiseDate,
              status: 'ACTIVE',
            },
          });
        }

        let updatedDpd = loanAfterPayment.dpd;
        if (item.outcome_type === 'PAID') {
          if (loanAfterPayment.outstanding_paise === 0) updatedDpd = 0;
          await transaction.promiseToPay.updateMany({
            where: {
              loan_id: item.loan_id,
              status: 'ACTIVE',
              promised_amount_paise: { lte: item.amount_collected_paise || 0 },
            },
            data: { status: 'FULFILLED' },
          });
        }

        const [allPromises, allOutcomes] = await Promise.all([
          transaction.promiseToPay.findMany({ where: { loan_id: item.loan_id } }),
          transaction.outcomeLog.findMany({ where: { loan_id: item.loan_id } }),
        ]);
        const aiResult = calculatePriorityScore({
          dpd: updatedDpd,
          outstanding_paise: loanAfterPayment.outstanding_paise,
          emi_amount_paise: loanAfterPayment.emi_amount_paise,
          promises: allPromises,
          recentOutcomes: allOutcomes,
        });
        await transaction.loan.update({
          where: { id: item.loan_id },
          data: {
            dpd: updatedDpd,
            priority_score: aiResult.priorityScore,
            priority_breakdown: JSON.stringify(aiResult.topBadges),
            ai_confidence: aiResult.aiConfidence,
            ai_uncertainty_reason: aiResult.aiUncertaintyReason,
          },
        });
        return { type: 'synced' as const, id: createdLog.id };
      });

      if (applied.type === 'payment-exceeds-balance') {
        receipts.push({ idempotency_key: item.idempotency_key, status: 'ERROR_PAYMENT_EXCEEDS_BALANCE' });
        continue;
      }
      if (applied.type === 'not-found') {
        receipts.push({ idempotency_key: item.idempotency_key, status: 'ERROR_LOAN_NOT_FOUND' });
        continue;
      }
      if (applied.type === 'not-assigned') {
        receipts.push({ idempotency_key: item.idempotency_key, status: 'ERROR_NOT_ASSIGNED' });
        continue;
      }
      if (applied.type === 'conflict') {
        receipts.push({ idempotency_key: item.idempotency_key, status: 'ERROR_IDEMPOTENCY_CONFLICT' });
        continue;
      }
      if (applied.type === 'duplicate') {
        duplicateCount += 1;
        receipts.push({ idempotency_key: item.idempotency_key, status: 'DUPLICATE_ALREADY_SYNCED', id: applied.id });
        continue;
      }

      syncedCount++;
      receipts.push({ idempotency_key: item.idempotency_key, status: 'SYNCED', id: applied.id });
    }

    return NextResponse.json({
      success: true,
      syncedCount,
      duplicateCount,
      totalReceived: logs.length,
      receipts,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('Batch sync error:', error);
    return NextResponse.json({ error: 'Failed to process batch sync' }, { status: 500 });
  }
}
