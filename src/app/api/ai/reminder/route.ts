import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateCompliantReminder, validateCommunicationGuardrails } from '@/lib/ai-guardrails';
import { checkRbiCompliance, isComplianceClockSimulationEnabled } from '@/lib/compliance';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireProductionDataUseApproval } from '@/lib/production-readiness';

const ReminderRequestSchema = z.object({
  loan_id: z.string().optional(),
  borrower_name: z.string(),
  owner_name: z.string(),
  account_number: z.string(),
  outstanding_paise: z.number().int().positive(),
  emi_amount_paise: z.number().int().positive(),
  promise_date: z.string().optional(),
  promised_amount_paise: z.number().int().positive().optional(),
  language: z.enum(['en', 'hi']).default('en'),
  officer_name: z.string().optional(),
  custom_draft: z.string().optional(),
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
    const rateLimitResponse = await enforceRateLimit(req, 'ai');
    if (rateLimitResponse) return rateLimitResponse;
    const releaseGateResponse = await requireProductionDataUseApproval();
    if (releaseGateResponse) return releaseGateResponse;

    const body = await req.json();
    const result = ReminderRequestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid reminder parameters', details: result.error.issues },
        { status: 400 }
      );
    }

    const {
      borrower_name,
      loan_id,
      owner_name,
      account_number,
      outstanding_paise,
      emi_amount_paise,
      promise_date,
      promised_amount_paise,
      language,
      officer_name,
      custom_draft,
    } = result.data;
    if (process.env.NODE_ENV === 'production' && !loan_id) {
      return NextResponse.json({ error: 'Loan ID is required.' }, { status: 400 });
    }
    if (session?.role === 'OFFICER' && loan_id) {
      const assignedLoan = await prisma.loan.findFirst({
        where: { id: loan_id, assigned_officer_id: session.userId },
        select: { id: true },
      });
      if (!assignedLoan) return NextResponse.json({ error: 'This loan is not assigned to the signed-in officer.' }, { status: 403 });
    }

    // Check simulated or current RBI window
    const simulationEnabled = isComplianceClockSimulationEnabled();
    const simulatedHeader = simulationEnabled ? req.headers.get('x-simulated-ist-hour') : null;
    const { searchParams } = new URL(req.url);
    const simulatedQuery = simulationEnabled ? searchParams.get('simulatedHour') : null;
    const simHour = simulatedHeader ? parseFloat(simulatedHeader) : (simulatedQuery ? parseFloat(simulatedQuery) : null);
    const compliance = checkRbiCompliance({ simulatedHour: simHour });

    // If custom draft is provided for testing guardrails
    if (custom_draft !== undefined && custom_draft !== null) {
      const guardrailResult = validateCommunicationGuardrails(
        custom_draft,
        outstanding_paise,
        emi_amount_paise,
        promised_amount_paise
      );

      return NextResponse.json({
        success: true,
        draft: custom_draft,
        sanitizedDraft: guardrailResult.sanitizedDraft,
        language,
        safe: guardrailResult.safe,
        violations: guardrailResult.violations,
        fallbackUsed: false,
        provider: 'custom-tested',
        rbiCompliance: compliance,
      });
    }

    // Otherwise generate fresh reminder (Gemini or DLT Template fallback)
    const generated = await generateCompliantReminder({
      borrowerName: borrower_name,
      ownerName: owner_name,
      accountNumber: account_number,
      outstandingPaise: outstanding_paise,
      emiAmountPaise: emi_amount_paise,
      promiseDate: promise_date,
      promisedAmountPaise: promised_amount_paise,
      officerName: officer_name || 'Ramesh Kumar',
      language,
    });

    return NextResponse.json({
      success: true,
      ...generated,
      rbiCompliance: compliance,
    });
  } catch (error) {
    console.error('Error generating AI reminder:', error);
    return NextResponse.json({ error: 'Failed to generate reminder' }, { status: 500 });
  }
}
