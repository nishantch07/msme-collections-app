import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { checkRbiCompliance, isComplianceClockSimulationEnabled, RBI_ERROR_RESPONSE } from '@/lib/compliance';
import { calculatePriorityScore } from '@/lib/priority-engine';
import { parseDateOnlyInIst } from '@/lib/date';
import { enforceRateLimit } from '@/lib/rate-limit';
import { hashOutcomePayload } from '@/lib/idempotency';
import { requireProductionDataUseApproval } from '@/lib/production-readiness';

const OutcomeSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  outcome_type: z.enum(['PAID', 'PTP', 'UNREACHABLE', 'DISPUTE', 'REFUSED']),
  amount_collected_paise: z.number().int().positive().nullable().optional(),
  promised_amount_paise: z.number().int().positive().nullable().optional(),
  promise_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(1000).default(''),
  gps_lat: z.number().min(-90).max(90),
  gps_lng: z.number().min(-180).max(180),
  gps_accuracy_m: z.number().positive().max(100000),
}).superRefine((data, context) => {
  if (data.outcome_type === 'PAID' && !data.amount_collected_paise) {
    context.addIssue({
      code: 'custom',
      path: ['amount_collected_paise'],
      message: 'Enter the amount collected for a paid outcome.',
    });
  }
  if (data.outcome_type === 'PTP' && (!data.promised_amount_paise || !data.promise_date)) {
    context.addIssue({
      code: 'custom',
      path: ['promise_date'],
      message: 'A promise amount and date are required for a promise-to-pay outcome.',
    });
  }
  if (data.promise_date && !parseDateOnlyInIst(data.promise_date)) {
    context.addIssue({
      code: 'custom',
      path: ['promise_date'],
      message: 'Enter a valid promise date.',
    });
  }
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: loanId } = await params;
    const session = await getCurrentUserFromHeadersOrCookies(req);
    if (process.env.NODE_ENV === 'production' && !session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (session && session.role !== 'OFFICER') {
      return NextResponse.json({ error: 'Field officer role required.' }, { status: 403 });
    }
    const rateLimitResponse = await enforceRateLimit(req, 'write');
    if (rateLimitResponse) return rateLimitResponse;
    const releaseGateResponse = await requireProductionDataUseApproval();
    if (releaseGateResponse) return releaseGateResponse;

    const body = await req.json();
    const parsed = OutcomeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid outcome data', details: parsed.error.issues },
        { status: 400 }
      );
    }
    const data = parsed.data;
    const promiseDate = data.promise_date ? parseDateOnlyInIst(data.promise_date) : null;

    const simulatedHeader = isComplianceClockSimulationEnabled()
      ? req.headers.get('x-simulated-ist-hour')
      : null;
    const { searchParams } = new URL(req.url);
    const simulatedQuery = isComplianceClockSimulationEnabled()
      ? searchParams.get('simulatedHour')
      : null;
    const simHour = simulatedHeader ? Number(simulatedHeader) : (simulatedQuery ? Number(simulatedQuery) : null);
    const compliance = checkRbiCompliance({ simulatedHour: simHour });
    if (!compliance.isAllowed) {
      return NextResponse.json(
        {
          ...RBI_ERROR_RESPONSE,
          details: compliance.reason,
          simulatedHour: compliance.currentIstHour,
          simulatedMinute: compliance.currentIstMinute,
        },
        { status: 403 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({
        where: { id: loanId },
      });
      if (!loan) return { type: 'not-found' as const };
      if (session?.role === 'OFFICER' && loan.assigned_officer_id !== session.userId) {
        return { type: 'forbidden' as const };
      }

      let officerId = session?.userId;
      if (!officerId) {
        const defaultOfficer = await tx.user.findFirst({
          where: { role: 'OFFICER' },
          select: { id: true },
        });
        officerId = defaultOfficer?.id;
      }
      if (!officerId) return { type: 'no-officer' as const };

      const payloadHash = hashOutcomePayload({ ...data, loan_id: loanId, officer_id: officerId });
      const existingLog = await tx.outcomeLog.findUnique({
        where: { idempotency_key: data.idempotency_key },
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
      if (existingLog) {
        const samePayload = existingLog.payload_hash
          ? existingLog.payload_hash === payloadHash
          : existingLog.loan_id === loanId
            && existingLog.officer_id === officerId
            && existingLog.outcome_type === data.outcome_type
            && existingLog.amount_collected_paise === (data.amount_collected_paise ?? null)
            && existingLog.notes === data.notes
            && existingLog.gps_lat === data.gps_lat
            && existingLog.gps_lng === data.gps_lng
            && existingLog.gps_accuracy_m === data.gps_accuracy_m;
        return samePayload
          ? { type: 'duplicate' as const, id: existingLog.id }
          : { type: 'conflict' as const };
      }

      if (data.outcome_type === 'PAID') {
        const paymentUpdate = await tx.loan.updateMany({
          where: {
            id: loanId,
            outstanding_paise: { gte: data.amount_collected_paise || 0 },
          },
          data: { outstanding_paise: { decrement: data.amount_collected_paise || 0 } },
        });
        if (paymentUpdate.count !== 1) return { type: 'invalid-payment' as const };
      }

      const currentLoan = data.outcome_type === 'PAID'
        ? await tx.loan.findUnique({ where: { id: loanId } })
        : loan;
      if (!currentLoan) return { type: 'not-found' as const };

      const capturedAt = new Date();
      const outcomeLog = await tx.outcomeLog.create({
        data: {
          idempotency_key: data.idempotency_key,
          payload_hash: payloadHash,
          loan_id: loanId,
          officer_id: officerId,
          outcome_type: data.outcome_type,
          amount_collected_paise: data.amount_collected_paise ?? null,
          notes: data.notes,
          gps_lat: data.gps_lat,
          gps_lng: data.gps_lng,
          gps_accuracy_m: data.gps_accuracy_m,
          captured_at_device: capturedAt,
        },
      });

      if (data.outcome_type === 'PTP' && data.promised_amount_paise && promiseDate) {
        await tx.promiseToPay.create({
          data: {
            loan_id: loanId,
            promised_amount_paise: data.promised_amount_paise,
            promise_date: promiseDate,
            status: 'ACTIVE',
          },
        });
      }

      const updatedOutstanding = currentLoan.outstanding_paise;
      let updatedDpd = currentLoan.dpd;
      if (data.outcome_type === 'PAID' && data.amount_collected_paise) {
        if (updatedOutstanding === 0) updatedDpd = 0;
        await tx.promiseToPay.updateMany({
          where: {
            loan_id: loanId,
            status: 'ACTIVE',
            promised_amount_paise: { lte: data.amount_collected_paise },
          },
          data: { status: 'FULFILLED' },
        });
      }

      const [promises, outcomes] = await Promise.all([
        tx.promiseToPay.findMany({ where: { loan_id: loanId } }),
        tx.outcomeLog.findMany({ where: { loan_id: loanId } }),
      ]);
      const aiResult = calculatePriorityScore({
        dpd: updatedDpd,
        outstanding_paise: updatedOutstanding,
        emi_amount_paise: currentLoan.emi_amount_paise,
        promises,
        recentOutcomes: outcomes,
      });
      const updatedLoan = await tx.loan.update({
        where: { id: loanId },
        data: {
          dpd: updatedDpd,
          priority_score: aiResult.priorityScore,
          priority_breakdown: JSON.stringify(aiResult.topBadges),
          ai_confidence: aiResult.aiConfidence,
          ai_uncertainty_reason: aiResult.aiUncertaintyReason,
        },
        include: {
          outcome_logs: { orderBy: { captured_at_device: 'desc' }, take: 5 },
          promises_to_pay: { orderBy: { promise_date: 'desc' }, take: 5 },
        },
      });

      return { type: 'success' as const, outcomeLog, updatedLoan, aiResult };
    });

    if (result.type === 'not-found') {
      return NextResponse.json({ error: 'Loan account not found.' }, { status: 404 });
    }
    if (result.type === 'forbidden') {
      return NextResponse.json({ error: 'This loan is not assigned to the signed-in officer.' }, { status: 403 });
    }
    if (result.type === 'conflict') {
      return NextResponse.json({ error: 'This idempotency key was already used for a different loan.' }, { status: 409 });
    }
    if (result.type === 'invalid-payment') {
      return NextResponse.json({ error: 'Collected amount cannot exceed the outstanding balance.' }, { status: 400 });
    }
    if (result.type === 'no-officer') {
      return NextResponse.json({ error: 'No field officer is available to record this outcome.' }, { status: 503 });
    }
    if (result.type === 'duplicate') {
      return NextResponse.json({
        success: true,
        isDuplicate: true,
        message: 'Outcome log already recorded.',
        outcomeLogId: result.id,
      });
    }

    return NextResponse.json({
      success: true,
      outcomeLog: result.outcomeLog,
      loan: result.updatedLoan,
      aiRecalculated: result.aiResult,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('Error logging outcome:', error);
    return NextResponse.json({ error: 'Failed to record visit outcome.' }, { status: 500 });
  }
}
