import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireProductionDataUseApproval } from '@/lib/production-readiness';
import { getIstStartOfToday } from '@/lib/date';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getCurrentUserFromHeadersOrCookies(req);
    if (process.env.NODE_ENV === 'production' && !session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (session && session.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Manager role required.' }, { status: 403 });
    }
    const rateLimitResponse = await enforceRateLimit(req, 'metrics');
    if (rateLimitResponse) return rateLimitResponse;
    const releaseGateResponse = await requireProductionDataUseApproval();
    if (releaseGateResponse) return releaseGateResponse;

    const todayStart = getIstStartOfToday();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const batches = await prisma.importBatch.findMany({
      orderBy: { imported_at: 'desc' },
      take: 2,
      select: { id: true, filename: true, imported_at: true, rows_received: true },
    });
    const backtestBatch = await prisma.importBatch.findFirst({
      where: { imported_at: { gte: sixtyDaysAgo, lte: thirtyDaysAgo } },
      orderBy: { imported_at: 'desc' },
      select: { id: true, imported_at: true },
    });
    const batchSnapshots = batches.length
      ? await prisma.loanScoreSnapshot.findMany({
          where: { import_batch_id: { in: batches.map((batch) => batch.id) } },
          select: {
            loan_id: true,
            pincode: true,
            branch_code: true,
            branch_name: true,
            dpd: true,
            priority_score: true,
            captured_at: true,
            import_batch_id: true,
          },
        })
      : [];
    const latestBatch = batches[0];
    const previousBatch = batches[1];
    const latestSnapshots = batchSnapshots.filter((snapshot) => snapshot.import_batch_id === latestBatch?.id);
    const previousSnapshots = new Map(
      batchSnapshots
        .filter((snapshot) => snapshot.import_batch_id === previousBatch?.id)
        .map((snapshot) => [snapshot.loan_id, snapshot])
    );

    const cohortByBranch = new Map<string, { eligible: number; rolled: number }>();
    let cohortEligible = 0;
    let cohortRolled = 0;
    for (const current of latestSnapshots) {
      const previous = previousSnapshots.get(current.loan_id);
      if (!previous || previous.dpd < 1 || previous.dpd > 30) continue;
      const branchLabel = previous.branch_name
        ? `${previous.branch_name} (${previous.branch_code})`
        : previous.branch_code
          ? `Branch ${previous.branch_code}`
        : `Unmapped pincode ${previous.pincode}`;
      const group = cohortByBranch.get(branchLabel) || { eligible: 0, rolled: 0 };
      group.eligible += 1;
      if (current.dpd >= 31 && current.dpd <= 60) {
        group.rolled += 1;
        cohortRolled += 1;
      }
      cohortEligible += 1;
      cohortByBranch.set(branchLabel, group);
    }

    const backtestSnapshots = backtestBatch
      ? await prisma.loanScoreSnapshot.findMany({
          where: { import_batch_id: backtestBatch.id },
          select: { loan_id: true, priority_score: true },
        })
      : [];
    const backtestEnd = backtestBatch
      ? new Date(backtestBatch.imported_at.getTime() + 30 * 24 * 60 * 60 * 1000)
      : thirtyDaysAgo;
    const paymentLogs = await prisma.outcomeLog.findMany({
      where: {
        outcome_type: 'PAID',
        captured_at_device: {
          ...(backtestBatch ? { gte: backtestBatch.imported_at, lte: backtestEnd } : { gte: backtestEnd }),
        },
      },
      select: { loan_id: true, captured_at_device: true, amount_collected_paise: true },
    });
    const paymentLoanIds = new Set(paymentLogs.map((log) => log.loan_id));
    const backtest = backtestSnapshots.map((snapshot) => ({
      score: snapshot.priority_score,
      paid: paymentLoanIds.has(snapshot.loan_id),
    }));
    const scoreBands = [
      { band: 'Low (0–39)', min: 0, max: 40 },
      { band: 'Medium (40–69)', min: 40, max: 70 },
      { band: 'High (70–100)', min: 70, max: 101 },
    ].map(({ band, min, max }) => {
      const sample = backtest.filter(({ score }) => score >= min && score < max);
      const paid = sample.filter(({ paid: wasPaid }) => wasPaid).length;
      return {
        band,
        sampleSize: sample.length,
        paidCount: paid,
        paymentRate: sample.length ? Math.round((paid / sample.length) * 1000) / 10 : null,
      };
    });

    const [activePromises, brokenPromises, promiseRows, recentOutcomes, recentContacts, loanCount, dailyCollected] = await Promise.all([
      prisma.promiseToPay.count({
        where: { status: 'ACTIVE', promise_date: { gte: todayStart } },
      }),
      prisma.promiseToPay.count({
        where: {
          OR: [
            { status: 'BROKEN' },
            { status: 'ACTIVE', promise_date: { lt: todayStart } },
          ],
        },
      }),
      prisma.promiseToPay.findMany({
        where: { status: { in: ['ACTIVE', 'BROKEN'] } },
        include: { loan: { select: { borrower_name: true, account_number: true, pincode: true } } },
        orderBy: { promise_date: 'asc' },
        take: 20,
      }),
      prisma.outcomeLog.findMany({
        include: {
          officer: { select: { name: true } },
          loan: { select: { borrower_name: true, account_number: true, pincode: true } },
        },
        orderBy: { synced_at_server: 'desc' },
        take: 20,
      }),
      prisma.contactAttempt.findMany({
        include: {
          officer: { select: { name: true } },
          loan: { select: { borrower_name: true, account_number: true, pincode: true } },
        },
        orderBy: { attempted_at: 'desc' },
        take: 20,
      }),
      prisma.loan.count(),
      prisma.outcomeLog.aggregate({
        where: { outcome_type: 'PAID', captured_at_device: { gte: todayStart } },
        _sum: { amount_collected_paise: true },
      }),
    ]);
    const byBranch: Array<{ branch: string; eligible: number; rolled: number; rate: number }> = [];
    cohortByBranch.forEach((counts, branch) => {
      byBranch.push({
        branch,
        eligible: counts.eligible,
        rolled: counts.rolled,
        rate: counts.eligible ? Math.round((counts.rolled / counts.eligible) * 1000) / 10 : 0,
      });
    });

    return NextResponse.json({
      success: true,
      rollRate: {
        eligible: cohortEligible,
        rolled: cohortRolled,
        rate: cohortEligible ? Math.round((cohortRolled / cohortEligible) * 1000) / 10 : null,
        byBranch,
        latestImport: latestBatch || null,
        previousImport: previousBatch || null,
      },
      backtest: {
        windowDays: 30,
        scoreBands,
        note: backtestBatch
          ? `Payment outcomes in the 30 days after the ${new Date(backtestBatch.imported_at).toLocaleDateString()} score snapshot.`
          : 'A score cohort at least 30 days old is required before a 30-day payment back-test can be shown.',
      },
      promises: {
        active: activePromises,
        broken: brokenPromises,
        items: promiseRows.map((promise) => ({
          ...promise,
          status: promise.status === 'ACTIVE' && promise.promise_date < todayStart
            ? 'BROKEN'
            : promise.status,
        })),
      },
      recentOutcomes,
      recentContacts,
      loanCount,
      collectedTodayPaise: dailyCollected._sum.amount_collected_paise || 0,
    });
  } catch (error) {
    console.error('Unable to build manager metrics:', error);
    return NextResponse.json({ error: 'Unable to load manager metrics.' }, { status: 500 });
  }
}
