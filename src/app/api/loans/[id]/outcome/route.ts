import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { checkRbiCompliance, RBI_ERROR_RESPONSE } from '@/lib/compliance';
import { calculatePriorityScore } from '@/lib/priority-engine';

const OutcomeSchema = z.object({
  idempotency_key: z.string().min(1),
  outcome_type: z.enum(['PAID', 'PTP', 'UNREACHABLE', 'DISPUTE', 'REFUSED']),
  amount_collected_paise: z.number().int().nonnegative().optional().nullable(),
  promised_amount_paise: z.number().int().positive().optional().nullable(),
  promise_date: z.string().optional().nullable(),
  notes: z.string().default(''),
  gps_lat: z.number().default(13.0285),
  gps_lng: z.number().default(77.5197),
  gps_accuracy_m: z.number().default(10.0),
  captured_at_device: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const loanId = params.id;

    // 1. RBI Compliance Check
    // Support simulated hour from header or URL for reviewer testing
    const simulatedHeader = req.headers.get('x-simulated-ist-hour');
    const { searchParams } = new URL(req.url);
    const simulatedQuery = searchParams.get('simulatedHour');
    const simHour = simulatedHeader ? parseFloat(simulatedHeader) : (simulatedQuery ? parseFloat(simulatedQuery) : null);

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

    // 2. Validate Body
    const body = await req.json();
    const parseResult = OutcomeSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid outcome data', details: parseResult.error.issues },
        { status: 400 }
      );
    }
    const data = parseResult.data;

    // 3. Idempotency Check
    const existingLog = await prisma.outcomeLog.findUnique({
      where: { idempotency_key: data.idempotency_key },
    });
    if (existingLog) {
      return NextResponse.json({
        success: true,
        isDuplicate: true,
        message: 'Outcome log already recorded (idempotent receipt).',
        outcomeLog: existingLog,
      });
    }

    // 4. Resolve Officer
    const session = await getCurrentUserFromHeadersOrCookies(req);
    let officerId = session?.userId;
    if (!officerId) {
      const defaultOfficer = await prisma.user.findFirst({
        where: { role: 'OFFICER' },
      });
      officerId = defaultOfficer?.id || 'anonymous-officer';
    }

    // 5. Verify Loan
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        promises_to_pay: true,
        outcome_logs: true,
      },
    });

    if (!loan) {
      return NextResponse.json({ error: 'Loan account not found' }, { status: 404 });
    }

    // 6. Record OutcomeLog
    const outcomeLog = await prisma.outcomeLog.create({
      data: {
        idempotency_key: data.idempotency_key,
        loan_id: loanId,
        officer_id: officerId,
        outcome_type: data.outcome_type,
        amount_collected_paise: data.amount_collected_paise || null,
        notes: data.notes,
        gps_lat: data.gps_lat,
        gps_lng: data.gps_lng,
        gps_accuracy_m: data.gps_accuracy_m,
        captured_at_device: data.captured_at_device ? new Date(data.captured_at_device) : new Date(),
      },
    });

    // 7. Handle PTP or Payment Updates
    if (data.outcome_type === 'PTP' && data.promised_amount_paise && data.promise_date) {
      await prisma.promiseToPay.create({
        data: {
          loan_id: loanId,
          promised_amount_paise: data.promised_amount_paise,
          promise_date: new Date(data.promise_date),
          status: 'ACTIVE',
        },
      });
    }

    let updatedOutstanding = loan.outstanding_paise;
    let updatedDpd = loan.dpd;

    if (data.outcome_type === 'PAID' && data.amount_collected_paise) {
      updatedOutstanding = Math.max(0, loan.outstanding_paise - data.amount_collected_paise);
      if (updatedOutstanding === 0) {
        updatedDpd = 0;
      }
    }

    // 8. Re-fetch all promises and outcomes for dynamic AI score recalculation
    const updatedPromises = await prisma.promiseToPay.findMany({
      where: { loan_id: loanId },
    });
    const updatedOutcomes = await prisma.outcomeLog.findMany({
      where: { loan_id: loanId },
    });

    const aiResult = calculatePriorityScore({
      dpd: updatedDpd,
      outstanding_paise: updatedOutstanding,
      emi_amount_paise: loan.emi_amount_paise,
      promises: updatedPromises,
      recentOutcomes: updatedOutcomes,
    });

    const updatedLoan = await prisma.loan.update({
      where: { id: loanId },
      data: {
        outstanding_paise: updatedOutstanding,
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

    return NextResponse.json({
      success: true,
      outcomeLog,
      loan: updatedLoan,
      aiRecalculated: aiResult,
    });
  } catch (error) {
    console.error('Error logging outcome:', error);
    return NextResponse.json({ error: 'Failed to record visit outcome' }, { status: 500 });
  }
}
