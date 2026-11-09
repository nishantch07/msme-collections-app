import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { calculatePriorityScore } from '@/lib/priority-engine';

const SyncBatchItemSchema = z.object({
  idempotency_key: z.string().min(1),
  loan_id: z.string().min(1),
  officer_id: z.string().optional(),
  outcome_type: z.enum(['PAID', 'PTP', 'UNREACHABLE', 'DISPUTE', 'REFUSED']),
  amount_collected_paise: z.number().int().nonnegative().optional().nullable(),
  promised_amount_paise: z.number().int().positive().optional().nullable(),
  promise_date: z.string().optional().nullable(),
  notes: z.string().default(''),
  gps_lat: z.number().default(13.0285),
  gps_lng: z.number().default(77.5197),
  gps_accuracy_m: z.number().default(10.0),
  captured_at_device: z.string(),
});

const BatchSchema = z.object({
  logs: z.array(SyncBatchItemSchema),
});

export async function POST(req: Request) {
  try {
    const session = await getCurrentUserFromHeadersOrCookies(req);
    let defaultOfficerId = session?.userId;
    if (!defaultOfficerId) {
      const defaultOfficer = await prisma.user.findFirst({ where: { role: 'OFFICER' } });
      defaultOfficerId = defaultOfficer?.id || 'officer-id';
    }

    const body = await req.json();
    const parseResult = BatchSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid batch sync format', details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { logs } = parseResult.data;
    const receipts = [];
    let syncedCount = 0;
    let duplicateCount = 0;

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
      const existing = await prisma.outcomeLog.findUnique({
        where: { idempotency_key: item.idempotency_key },
      });

      if (existing) {
        duplicateCount++;
        receipts.push({
          idempotency_key: item.idempotency_key,
          status: 'DUPLICATE_ALREADY_SYNCED',
          id: existing.id,
        });
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

      // Insert new log
      const createdLog = await prisma.outcomeLog.create({
        data: {
          idempotency_key: item.idempotency_key,
          loan_id: item.loan_id,
          officer_id: item.officer_id || defaultOfficerId,
          outcome_type: item.outcome_type,
          amount_collected_paise: item.amount_collected_paise || null,
          notes: item.notes,
          gps_lat: item.gps_lat,
          gps_lng: item.gps_lng,
          gps_accuracy_m: item.gps_accuracy_m,
          captured_at_device: new Date(item.captured_at_device),
        },
      });

      // Handle PTP
      if (item.outcome_type === 'PTP' && item.promised_amount_paise && item.promise_date) {
        await prisma.promiseToPay.create({
          data: {
            loan_id: item.loan_id,
            promised_amount_paise: item.promised_amount_paise,
            promise_date: new Date(item.promise_date),
            status: 'ACTIVE',
          },
        });
      }

      // Handle Payment
      let updatedOutstanding = loan.outstanding_paise;
      let updatedDpd = loan.dpd;
      if (item.outcome_type === 'PAID' && item.amount_collected_paise) {
        updatedOutstanding = Math.max(0, loan.outstanding_paise - item.amount_collected_paise);
        if (updatedOutstanding === 0) updatedDpd = 0;
      }

      // Recalculate AI score
      const allPromises = await prisma.promiseToPay.findMany({ where: { loan_id: item.loan_id } });
      const allOutcomes = await prisma.outcomeLog.findMany({ where: { loan_id: item.loan_id } });

      const aiResult = calculatePriorityScore({
        dpd: updatedDpd,
        outstanding_paise: updatedOutstanding,
        emi_amount_paise: loan.emi_amount_paise,
        promises: allPromises,
        recentOutcomes: allOutcomes,
      });

      await prisma.loan.update({
        where: { id: item.loan_id },
        data: {
          outstanding_paise: updatedOutstanding,
          dpd: updatedDpd,
          priority_score: aiResult.priorityScore,
          priority_breakdown: JSON.stringify(aiResult.topBadges),
          ai_confidence: aiResult.aiConfidence,
          ai_uncertainty_reason: aiResult.aiUncertaintyReason,
        },
      });

      syncedCount++;
      receipts.push({
        idempotency_key: item.idempotency_key,
        status: 'SYNCED',
        id: createdLog.id,
      });
    }

    return NextResponse.json({
      success: true,
      syncedCount,
      duplicateCount,
      totalReceived: logs.length,
      receipts,
    });
  } catch (error) {
    console.error('Batch sync error:', error);
    return NextResponse.json({ error: 'Failed to process batch sync' }, { status: 500 });
  }
}
