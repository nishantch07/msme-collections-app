import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';

const OverrideSchema = z.object({
  manual_override_score: z.number().min(0).max(100),
  manual_override_reason: z.string().min(5, 'Documented override reason must be at least 5 characters'),
  target_confidence: z.enum(['HIGH', 'LOW_CONFIDENCE', 'DISPUTE_HOLD']).default('HIGH'),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const loanId = params.id;
    const session = await getCurrentUserFromHeadersOrCookies(req);

    const body = await req.json();
    const parseResult = OverrideSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid override request', details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { manual_override_score, manual_override_reason, target_confidence } = parseResult.data;

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
    }

    const updatedLoan = await prisma.loan.update({
      where: { id: loanId },
      data: {
        manual_override_score,
        manual_override_reason: `[${session?.name || 'Human Reviewer'}] ${manual_override_reason}`,
        ai_confidence: target_confidence,
        ai_uncertainty_reason: target_confidence === 'HIGH' ? null : loan.ai_uncertainty_reason,
      },
      include: {
        outcome_logs: { orderBy: { captured_at_device: 'desc' }, take: 5 },
        promises_to_pay: { orderBy: { promise_date: 'desc' }, take: 5 },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'AI uncertainty flag resolved with manual reviewer override.',
      loan: updatedLoan,
    });
  } catch (error) {
    console.error('Error overriding AI flag:', error);
    return NextResponse.json({ error: 'Failed to record manual override' }, { status: 500 });
  }
}
