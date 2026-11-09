import { NextResponse } from 'next/server';
import { getProductionReadinessChecks } from '@/lib/production-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = await getProductionReadinessChecks();
  const ready = checks.database
    && checks.sessionSecret
    && checks.distributedRateLimit
    && checks.privacyNoticeApproved
    && checks.retentionPolicyApproved
    && checks.productionDataUseApproved
    && checks.branchMasterIntegrated
    && checks.fieldDeviceValidation;

  return NextResponse.json(
    {
      status: ready ? 'ready_with_restrictions' : 'blocked',
      productionDataUse: ready ? 'enabled' : 'disabled',
      checks,
    },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
