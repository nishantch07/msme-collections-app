import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireProductionDataUseApproval } from '@/lib/production-readiness';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pincode = searchParams.get('pincode');
    const confidence = searchParams.get('confidence');
    const q = searchParams.get('q');
    const officerId = searchParams.get('officerId');
    const page = Number(searchParams.get('page') || '0');
    if (!Number.isInteger(page) || page < 0 || page > 1000) {
      return NextResponse.json({ error: 'Page must be a non-negative integer.' }, { status: 400 });
    }

    const currentUser = await getCurrentUserFromHeadersOrCookies(req);
    if (process.env.NODE_ENV === 'production' && !currentUser) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    const rateLimitResponse = await enforceRateLimit(req, 'read');
    if (rateLimitResponse) return rateLimitResponse;
    const releaseGateResponse = await requireProductionDataUseApproval();
    if (releaseGateResponse) return releaseGateResponse;

    // Build Prisma where filter
    const whereClause: Prisma.LoanWhereInput = {};

    if (pincode && pincode !== 'ALL' && pincode !== 'all') {
      whereClause.pincode = pincode;
    }

    if (confidence && confidence !== 'ALL' && confidence !== 'all') {
      whereClause.ai_confidence = confidence;
    }

    if (currentUser?.role === 'OFFICER') {
      whereClause.assigned_officer_id = currentUser.userId;
    } else if (officerId) {
      const demoOfficer = process.env.NODE_ENV !== 'production' && officerId === 'seed-officer'
        ? await prisma.user.findUnique({
            where: { email: 'officer@msmelender.in' },
            select: { id: true },
          })
        : null;
      whereClause.assigned_officer_id = demoOfficer?.id || officerId;
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

    const [loans, totalCount, exposure, uncertainCount] = await Promise.all([
      prisma.loan.findMany({
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
        orderBy: [{ priority_score: 'desc' }, { id: 'asc' }],
        skip: page * 100,
        take: 100,
      }),
      prisma.loan.count({ where: whereClause }),
      prisma.loan.aggregate({
        where: whereClause,
        _sum: { outstanding_paise: true },
      }),
      prisma.loan.count({
        where: { ...whereClause, ai_confidence: { not: 'HIGH' } },
      }),
    ]);

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
      page,
      pageSize: 100,
      totalCount,
      hasMore: (page + 1) * 100 < totalCount,
      summary: {
        totalExposurePaise: exposure._sum.outstanding_paise || 0,
        uncertainCount,
      },
      loans: sortedLoans,
      currentUser,
    });
  } catch (error) {
    console.error('Error fetching loans:', error);
    return NextResponse.json({ error: 'Failed to fetch loans' }, { status: 500 });
  }
}
