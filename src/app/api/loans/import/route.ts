import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { calculatePriorityScore } from '@/lib/priority-engine';
import { getCsvValue, normalizeCsvHeader, parseCsv } from '@/lib/csv-import';
import { getIstStartOfToday, parseDateOnlyInIst } from '@/lib/date';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireProductionDataUseApproval } from '@/lib/production-readiness';

const valueFor = (
  row: string[],
  headers: Map<string, number>,
  names: string[]
) => getCsvValue(row, headers, names);

const coordinateFor = (
  value: string | undefined,
  previous: number | null | undefined,
  minimum: number,
  maximum: number,
  field: string
): number | null => {
  if (!value) return previous ?? null;
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw new Error(`${field} must be a valid coordinate between ${minimum} and ${maximum}.`);
  }
  return coordinate;
};

const loanHistoryInclude = {
  promises_to_pay: true,
  outcome_logs: {
    where: {
      captured_at_device: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    },
  },
} satisfies Prisma.LoanInclude;

type ExistingLoan = Prisma.LoanGetPayload<{ include: typeof loanHistoryInclude }>;

export async function POST(req: Request) {
  try {
    const session = await getCurrentUserFromHeadersOrCookies(req);
    if (process.env.NODE_ENV === 'production' && !session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (session && session.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Manager role required to import loans.' }, { status: 403 });
    }
    const rateLimitResponse = await enforceRateLimit(req, 'import');
    if (rateLimitResponse) return rateLimitResponse;
    const releaseGateResponse = await requireProductionDataUseApproval();
    if (releaseGateResponse) return releaseGateResponse;

    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string' || !file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Choose a .csv file to import.' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'CSV files must be 10 MB or smaller.' }, { status: 413 });
    }

    const rows = parseCsv(await file.text());
    if (rows.length > 50001) {
      return NextResponse.json({ error: 'A single import is limited to 50,000 data rows.' }, { status: 413 });
    }
    if (rows.length < 2) {
      return NextResponse.json({ error: 'The CSV must include a header and at least one data row.' }, { status: 400 });
    }

    const headers = new Map(
      rows[0].map((header, index) => [normalizeCsvHeader(header), index])
    );
    const officers = await prisma.user.findMany({
      where: { role: 'OFFICER' },
      select: { id: true, name: true, assigned_pincode: true },
    });
    const branchMappings = await prisma.branchPincode.findMany({
      include: { branch: { select: { id: true, branch_code: true, name: true } } },
    });
    const branchesByPincode = new Map(
      branchMappings.map((mapping) => [mapping.pincode, mapping.branch])
    );
    const workload = new Map<string, number>();
    for (const officer of officers) {
      workload.set(officer.id, 0);
    }
    const workloads = await prisma.loan.groupBy({
      by: ['assigned_officer_id'],
      _count: { _all: true },
      where: { assigned_officer_id: { not: null } },
    });
    for (const item of workloads) {
      if (item.assigned_officer_id) workload.set(item.assigned_officer_id, item._count._all);
    }

    const accountNumbers = rows.slice(1)
      .map((row) => valueFor(row, headers, ['account_number', 'account', 'loan_id', 'loan id']))
      .filter((accountNumber): accountNumber is string => Boolean(accountNumber));
    const existingByAccount = new Map<string, ExistingLoan>();
    for (let offset = 0; offset < accountNumbers.length; offset += 500) {
      const loansChunk = await prisma.loan.findMany({
        where: { account_number: { in: accountNumbers.slice(offset, offset + 500) } },
        include: loanHistoryInclude,
      });
      loansChunk.forEach((loan) => existingByAccount.set(loan.account_number, loan));
    }

    const importBatch = await prisma.importBatch.create({
      data: {
        filename: file.name,
        imported_by: session?.userId || 'demo-manager',
        rows_received: rows.length - 1,
        rows_created: 0,
        rows_updated: 0,
        rows_rejected: 0,
      },
    });

    let rowsCreated = 0;
    let rowsUpdated = 0;
    const errors: Array<{ row: number; message: string }> = [];
    const unassigned: Array<{ row: number; accountNumber: string; pincode: string }> = [];
    const seenAccounts = new Set<string>();

    for (let index = 0; index < rows.length - 1; index += 1) {
      const row = rows[index + 1];
      const lineNumber = index + 2;
      try {
        const accountNumber = valueFor(row, headers, ['account_number', 'account', 'loan_id', 'loan id']);
        const borrowerName = valueFor(row, headers, ['borrower_name', 'borrower', 'customer_name', 'customer']);
        const outstanding = valueFor(row, headers, ['outstanding_paise', 'outstanding', 'outstanding ₹', 'amount']);
        const dpdValue = valueFor(row, headers, ['dpd', 'days_past_due']);
        const officerHint = valueFor(row, headers, ['officer', 'officer_name', 'assigned_officer']);
        const hintedOfficer = officerHint
          ? officers.find((officer) => officer.id === officerHint || officer.name.toLowerCase() === officerHint.toLowerCase())
          : null;
        const pincode = valueFor(row, headers, ['pincode', 'pin', 'postal_code'])
          || hintedOfficer?.assigned_pincode
          || (session?.assignedPincode !== 'ALL' ? session?.assignedPincode : undefined);
        if (!pincode) throw new Error('Pincode is required unless the CSV Officer value matches an assigned officer.');
        const branch = branchesByPincode.get(pincode);
        if (process.env.NODE_ENV === 'production' && !branch) {
          throw new Error(`Pincode ${pincode} has no approved branch-master mapping. Import the branch master before overdue loans.`);
        }
        const outstandingPaise = outstanding && headers.has(normalizeCsvHeader('outstanding_paise'))
          ? Number(outstanding)
          : Math.round(Number((outstanding || '').replace(/[₹,\s]/g, '')) * 100);
        const dpd = Number(dpdValue);

        if (!accountNumber || !borrowerName || !Number.isSafeInteger(outstandingPaise) || outstandingPaise <= 0 || !Number.isInteger(dpd) || dpd < 0) {
          throw new Error('Required fields: Loan ID, Borrower, positive Outstanding amount, and non-negative DPD.');
        }
        if (seenAccounts.has(accountNumber)) throw new Error(`Duplicate Loan ID "${accountNumber}" in this file.`);
        seenAccounts.add(accountNumber);

        const promiseDateText = valueFor(row, headers, ['promise_date', 'ptp_date']);
        let promiseDate: Date | null = null;
        if (promiseDateText) {
          const dateOnly = promiseDateText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
          promiseDate = dateOnly ? parseDateOnlyInIst(dateOnly) : null;
          if (!promiseDate) throw new Error(`Invalid promise date "${promiseDateText}". Use YYYY-MM-DD.`);
        }

        const existing = existingByAccount.get(accountNumber);
        const eligible = officers
          .filter((officer) => officer.assigned_pincode === pincode || officer.assigned_pincode === 'ALL');
        const assignedOfficerId = existing?.assigned_officer_id
          || eligible.sort((left, right) => (workload.get(left.id) || 0) - (workload.get(right.id) || 0))[0]?.id
          || null;

        const emiValue = valueFor(row, headers, ['emi_amount_paise', 'emi', 'monthly_emi']);
        const emiPaise = emiValue
          ? (headers.has(normalizeCsvHeader('emi_amount_paise'))
            ? Number(emiValue)
            : Math.round(Number(emiValue.replace(/[₹,\s]/g, '')) * 100))
          : existing?.emi_amount_paise || Math.min(outstandingPaise, Math.round(outstandingPaise / 10));
        if (!Number.isSafeInteger(emiPaise) || emiPaise <= 0) throw new Error('EMI amount must be a positive number.');

        const score = calculatePriorityScore({
          dpd,
          outstanding_paise: outstandingPaise,
          emi_amount_paise: emiPaise,
          promises: existing?.promises_to_pay || [],
          recentOutcomes: existing?.outcome_logs || [],
          hasUnresolvedDispute: existing?.ai_confidence === 'DISPUTE_HOLD',
        });

        const details = {
          borrower_name: borrowerName,
          owner_name: valueFor(row, headers, ['owner_name', 'owner']) || existing?.owner_name || borrowerName,
          phone: valueFor(row, headers, ['phone', 'mobile', 'phone_number']) || existing?.phone || '',
          business_type: valueFor(row, headers, ['business_type', 'business', 'industry']) || existing?.business_type || 'MSME',
          outstanding_paise: outstandingPaise,
          emi_amount_paise: emiPaise,
          dpd,
          pincode,
          gps_lat: coordinateFor(valueFor(row, headers, ['gps_lat', 'latitude']), existing?.gps_lat, -90, 90, 'Latitude'),
          gps_lng: coordinateFor(valueFor(row, headers, ['gps_lng', 'longitude']), existing?.gps_lng, -180, 180, 'Longitude'),
          priority_score: score.priorityScore,
          priority_breakdown: JSON.stringify(score.topBadges),
          ai_confidence: score.aiConfidence,
          ai_uncertainty_reason: score.aiUncertaintyReason,
          assigned_officer_id: assignedOfficerId,
          branch_id: branch?.id || existing?.branch_id || null,
        };
        await prisma.$transaction(async (tx) => {
          const importedLoan = await tx.loan.upsert({
            where: { account_number: accountNumber },
            create: {
              account_number: accountNumber,
              ...details,
            },
            update: details,
          });

          if (promiseDate) {
            const existingPromise = await tx.promiseToPay.findFirst({
              where: { loan_id: importedLoan.id, promise_date: promiseDate },
            });
            if (!existingPromise) {
              const isPast = promiseDate.getTime() < getIstStartOfToday().getTime();
              await tx.promiseToPay.create({
                data: {
                  loan_id: importedLoan.id,
                  promised_amount_paise: emiPaise,
                  promise_date: promiseDate,
                  status: isPast ? 'BROKEN' : 'ACTIVE',
                },
              });
            }
          }

          await tx.loanScoreSnapshot.create({
            data: {
              loan_id: importedLoan.id,
              import_batch_id: importBatch.id,
              pincode,
              branch_code: branch?.branch_code || null,
              branch_name: branch?.name || null,
              dpd,
              outstanding_paise: outstandingPaise,
              priority_score: score.priorityScore,
            },
          });
          return importedLoan;
        });
        if (!assignedOfficerId) {
          unassigned.push({ row: lineNumber, accountNumber, pincode });
        }
        if (assignedOfficerId) workload.set(assignedOfficerId, (workload.get(assignedOfficerId) || 0) + 1);
        if (existing) rowsUpdated += 1;
        else rowsCreated += 1;
      } catch (error) {
        errors.push({
          row: lineNumber,
          message: error instanceof Error ? error.message : 'Row could not be imported.',
        });
      }
    }

    await prisma.importBatch.update({
      where: { id: importBatch.id },
      data: {
        rows_created: rowsCreated,
        rows_updated: rowsUpdated,
        rows_rejected: errors.length,
      },
    });

    return NextResponse.json({
      success: true,
      batchId: importBatch.id,
      rowsReceived: rows.length - 1,
      rowsCreated,
      rowsUpdated,
      rowsRejected: errors.length,
      rowsUnassigned: unassigned.length,
      unassigned,
      errors,
    }, { status: errors.length > 0 && rowsCreated + rowsUpdated === 0 ? 422 : 200 });
  } catch (error) {
    console.error('Loan CSV import failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import CSV.' },
      { status: 400 }
    );
  }
}
