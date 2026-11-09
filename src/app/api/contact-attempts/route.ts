import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { checkRbiCompliance, isComplianceClockSimulationEnabled } from '@/lib/compliance';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireProductionDataUseApproval } from '@/lib/production-readiness';

const AttemptSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  loan_id: z.string().min(1).max(128),
  channel: z.enum(['CALL', 'WHATSAPP']),
  gps_lat: z.number().min(-90).max(90).optional(),
  gps_lng: z.number().min(-180).max(180).optional(),
  simulated_hour: z.number().min(0).max(23.99).optional(),
  simulated_minute: z.number().int().min(0).max(59).optional(),
}).superRefine((attempt, context) => {
  if ((attempt.gps_lat === undefined) !== (attempt.gps_lng === undefined)) {
    context.addIssue({ code: 'custom', path: ['gps_lat'], message: 'Contact GPS must include both coordinates.' });
  }
});

export async function POST(req: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(req, 'contact');
    if (rateLimitResponse) return rateLimitResponse;

    const parsed = AttemptSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid contact attempt.', details: parsed.error.issues }, { status: 400 });
    }

    const { idempotency_key, loan_id, channel, gps_lat, gps_lng, simulated_hour, simulated_minute } = parsed.data;
    const session = await getCurrentUserFromHeadersOrCookies(req);
    if (process.env.NODE_ENV === 'production' && !session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (session && session.role !== 'OFFICER') {
      return NextResponse.json({ error: 'Field officer role required.' }, { status: 403 });
    }
    const releaseGateResponse = await requireProductionDataUseApproval();
    if (releaseGateResponse) return releaseGateResponse;
    const existing = await prisma.contactAttempt.findUnique({ where: { idempotency_key } });
    if (existing) {
      if (existing.loan_id !== loan_id || (session && existing.officer_id !== session.userId)) {
        return NextResponse.json({ error: 'This idempotency key was already used for a different contact attempt.' }, { status: 409 });
      }
      if (existing.status === 'BLOCKED' || (process.env.NODE_ENV === 'production' && channel === 'WHATSAPP')) {
        return NextResponse.json({
          error: 'CONTACT_BLOCKED',
          message: existing.details || 'This contact action is blocked.',
          attemptId: existing.id,
        }, { status: 403 });
      }
      return NextResponse.json({ success: true, duplicate: true, attemptId: existing.id });
    }
    const loan = await prisma.loan.findUnique({ where: { id: loan_id } });
    if (!loan) return NextResponse.json({ error: 'Loan account not found.' }, { status: 404 });
    if (session?.role === 'OFFICER' && loan.assigned_officer_id !== session.userId) {
      return NextResponse.json({ error: 'This loan is not assigned to the signed-in officer.' }, { status: 403 });
    }

    const headerHour = req.headers.get('x-simulated-ist-hour');
    const simulationEnabled = isComplianceClockSimulationEnabled();
    const hour = simulationEnabled
      ? simulated_hour ?? (headerHour === null ? null : Number(headerHour))
      : null;
    const compliance = checkRbiCompliance({
      simulatedHour: hour,
      simulatedMinute: simulationEnabled ? simulated_minute : undefined,
    });
    const messagingUnavailable = process.env.NODE_ENV === 'production' && channel === 'WHATSAPP';

    let officerId = session?.userId;
    if (!officerId || !(await prisma.user.findUnique({ where: { id: officerId }, select: { id: true } }))) {
      const officer = await prisma.user.findFirst({ where: { role: 'OFFICER' }, select: { id: true } });
      if (!officer) return NextResponse.json({ error: 'No officer is available to record this action.' }, { status: 503 });
      officerId = officer.id;
    }

    const attempt = await prisma.contactAttempt.create({
      data: {
        idempotency_key,
        loan_id,
        officer_id: officerId,
        channel,
        status: compliance.isAllowed && !messagingUnavailable ? 'INITIATED' : 'BLOCKED',
        attempted_at: new Date(),
        ist_time: compliance.currentTimeString,
        gps_lat,
        gps_lng,
        details: messagingUnavailable
          ? 'Production messaging is blocked until an approved template and sending integration are implemented.'
          : compliance.isAllowed ? null : compliance.reason,
      },
    });

    if (messagingUnavailable) {
      return NextResponse.json({
        error: 'MESSAGING_NOT_CONFIGURED',
        message: 'WhatsApp messaging is disabled in production until the lender-approved template and sending integration are configured. This blocked attempt has been recorded.',
        attemptId: attempt.id,
        time: compliance.currentTimeString,
      }, { status: 403 });
    }

    if (!compliance.isAllowed) {
      return NextResponse.json({
        error: 'COMPLIANCE_WINDOW_LOCKED',
        message: 'Contact blocked outside 08:00–19:00 IST. This attempt has been recorded.',
        attemptId: attempt.id,
        time: compliance.currentTimeString,
      }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      attemptId: attempt.id,
      time: compliance.currentTimeString,
      message: 'Contact attempt recorded. Continue only after confirming the borrower and message.',
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('Unable to record contact attempt:', error);
    return NextResponse.json({ error: 'Unable to record contact attempt.' }, { status: 500 });
  }
}
