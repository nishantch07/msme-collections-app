import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pincode = searchParams.get('pincode');
    const confidence = searchParams.get('confidence');
    const q = searchParams.get('q');
    const officerId = searchParams.get('officerId');

    const currentUser = await getCurrentUserFromHeadersOrCookies(req);

    // Build Prisma where filter
    const whereClause: Record<string, unknown> = {};

    if (pincode && pincode !== 'ALL' && pincode !== 'all') {
      whereClause.pincode = pincode;
    }

    if (confidence && confidence !== 'ALL' && confidence !== 'all') {
      whereClause.ai_confidence = confidence;
    }

    if (officerId) {
      whereClause.assigned_officer_id = officerId;
    }

    if (q && q.trim()) {
      const term = q.trim();
      whereClause.OR = [
        { borrower_name: { contains: term } },
        { owner_name: { contains: term } },
        { account_number: { contains: term } },
        { phone: { contains: term } },
        { business_type: { contains: term } },
      ];
    }

    const loans = await prisma.loan.findMany({
      where: whereClause,
      include: {
        assigned_officer: {
          select: { id: true, name: true, email: true },
        },
        outcome_logs: {
          orderBy: { captured_at_device: 'desc' },
          take: 5,
        },
        promises_to_pay: {
          orderBy: { promise_date: 'desc' },
          take: 5,
        },
      },
      orderBy: [
        { priority_score: 'desc' },
      ],
    });

    // Sort by effective priority (manual override takes precedence if set)
    const sortedLoans = [...loans].sort((a, b) => {
      const scoreA = a.manual_override_score !== null && a.manual_override_score !== undefined
        ? a.manual_override_score
        : a.priority_score;
      const scoreB = b.manual_override_score !== null && b.manual_override_score !== undefined
        ? b.manual_override_score
        : b.priority_score;
      return scoreB - scoreA;
    });

    return NextResponse.json({
      success: true,
      count: sortedLoans.length,
      loans: sortedLoans,
      currentUser,
    });
  } catch (error) {
    console.error('Error fetching loans:', error);
    return NextResponse.json({ error: 'Failed to fetch loans' }, { status: 500 });
  }
}
