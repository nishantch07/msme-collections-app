import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromHeadersOrCookies } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCsvValue, normalizeCsvHeader, parseCsv } from '@/lib/csv-import';

const BranchRowSchema = z.object({
  branchCode: z.string().trim().min(1).max(64),
  branchName: z.string().trim().min(1).max(200),
  pincode: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentUserFromHeadersOrCookies(request);
    if (process.env.NODE_ENV === 'production' && !session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (session && session.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Manager role required to import branch mappings.' }, { status: 403 });
    }
    const rateLimitResponse = await enforceRateLimit(request, 'import');
    if (rateLimitResponse) return rateLimitResponse;

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string' || !file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Choose a branch-master .csv file.' }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Branch CSV files must be 2 MB or smaller.' }, { status: 413 });
    }

    const rows = parseCsv(await file.text());
    if (rows.length < 2 || rows.length > 5001) {
      return NextResponse.json({ error: 'The branch CSV must contain a header and 1–5,000 mapping rows.' }, { status: 400 });
    }
    const headers = new Map(rows[0].map((header, index) => [normalizeCsvHeader(header), index]));
    const requiredHeaders = ['branch_code', 'branch_name', 'pincode'];
    if (requiredHeaders.some((header) => !headers.has(header))) {
      return NextResponse.json({
        error: 'Required branch CSV headers are branch_code, branch_name, and pincode.',
      }, { status: 400 });
    }

    const mappings: Array<z.infer<typeof BranchRowSchema>> = [];
    const errors: Array<{ row: number; message: string }> = [];
    const seenPincodes = new Set<string>();
    const branchNames = new Map<string, string>();
    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index];
      const parsed = BranchRowSchema.safeParse({
        branchCode: getCsvValue(row, headers, ['branch_code']),
        branchName: getCsvValue(row, headers, ['branch_name']),
        pincode: getCsvValue(row, headers, ['pincode']),
      });
      if (!parsed.success) {
        errors.push({ row: index + 1, message: 'Enter a branch code, branch name, and six-digit pincode.' });
        continue;
      }

      const value = parsed.data;
      if (seenPincodes.has(value.pincode)) {
        errors.push({ row: index + 1, message: `Pincode ${value.pincode} occurs more than once.` });
        continue;
      }
      const existingName = branchNames.get(value.branchCode);
      if (existingName && existingName !== value.branchName) {
        errors.push({ row: index + 1, message: `Branch code ${value.branchCode} has inconsistent names.` });
        continue;
      }
      seenPincodes.add(value.pincode);
      branchNames.set(value.branchCode, value.branchName);
      mappings.push(value);
    }
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Branch master was not imported; correct the listed rows and retry.', errors }, { status: 422 });
    }

    await prisma.$transaction(async (transaction) => {
      const branchIds = new Map<string, string>();
      const importedPincodes = new Set(mappings.map((mapping) => mapping.pincode));
      const existingMappings = await transaction.branchPincode.findMany({
        select: { pincode: true },
      });
      const removedPincodes = existingMappings
        .map((mapping) => mapping.pincode)
        .filter((pincode) => !importedPincodes.has(pincode));
      if (removedPincodes.length > 0) {
        await transaction.loan.updateMany({
          where: { pincode: { in: removedPincodes } },
          data: { branch_id: null },
        });
        await transaction.branchPincode.deleteMany({
          where: { pincode: { in: removedPincodes } },
        });
      }

      for (const [branchCode, branchName] of branchNames) {
        const branch = await transaction.branch.upsert({
          where: { branch_code: branchCode },
          create: { branch_code: branchCode, name: branchName },
          update: { name: branchName },
          select: { id: true },
        });
        branchIds.set(branchCode, branch.id);
      }
      for (const mapping of mappings) {
        const branchId = branchIds.get(mapping.branchCode);
        if (!branchId) throw new Error(`Branch ${mapping.branchCode} was not created.`);
        await transaction.branchPincode.upsert({
          where: { pincode: mapping.pincode },
          create: { pincode: mapping.pincode, branch_id: branchId },
          update: { branch_id: branchId },
        });
        await transaction.loan.updateMany({
          where: { pincode: mapping.pincode },
          data: { branch_id: branchId },
        });
      }
    });

    return NextResponse.json({ success: true, rowsImported: mappings.length, branchesImported: branchNames.size });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request must contain valid form data.' }, { status: 400 });
    }
    console.error('Branch master import failed:', error);
    return NextResponse.json({ error: 'Unable to import branch master.' }, { status: 500 });
  }
}
