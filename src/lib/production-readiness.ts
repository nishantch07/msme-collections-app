import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export interface ProductionReadinessChecks {
  database: boolean;
  sessionSecret: boolean;
  distributedRateLimit: boolean;
  privacyNoticeApproved: boolean;
  retentionPolicyApproved: boolean;
  productionDataUseApproved: boolean;
  branchMasterIntegrated: boolean;
  registeredDltTemplateProvided: boolean;
  approvedMessagingIntegration: boolean;
  fieldDeviceValidation: boolean;
}

const readinessCacheDurationMs = 15_000;
let cachedChecks: { checks: ProductionReadinessChecks; expiresAt: number } | null = null;
let checksRequest: Promise<ProductionReadinessChecks> | null = null;

async function loadProductionReadinessChecks(): Promise<ProductionReadinessChecks> {
  let database = false;
  let branchMasterIntegrated = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
    const [branchCount, pincodeMappingCount] = await Promise.all([
      prisma.branch.count(),
      prisma.branchPincode.count(),
    ]);
    branchMasterIntegrated = branchCount > 0 && pincodeMappingCount > 0;
  } catch (error) {
    console.error('Production readiness database check failed:', error);
  }

  return {
    database,
    sessionSecret: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32),
    distributedRateLimit: Boolean(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ),
    privacyNoticeApproved: Boolean(process.env.PRIVACY_NOTICE_VERSION),
    retentionPolicyApproved: Boolean(process.env.DATA_RETENTION_POLICY_VERSION),
    productionDataUseApproved: process.env.PRODUCTION_DATA_USE_APPROVED === 'true',
    branchMasterIntegrated,
    registeredDltTemplateProvided: Boolean(process.env.APPROVED_DLT_TEMPLATE_ID),
    approvedMessagingIntegration: false,
    fieldDeviceValidation: Boolean(process.env.FIELD_DEVICE_VALIDATION_VERSION),
  };
}

export async function getProductionReadinessChecks(): Promise<ProductionReadinessChecks> {
  if (cachedChecks && cachedChecks.expiresAt > Date.now()) return cachedChecks.checks;
  if (checksRequest) return checksRequest;
  checksRequest = loadProductionReadinessChecks();
  try {
    const checks = await checksRequest;
    cachedChecks = { checks, expiresAt: Date.now() + readinessCacheDurationMs };
    return checks;
  } finally {
    checksRequest = null;
  }
}

export async function requireProductionDataUseApproval(): Promise<NextResponse | null> {
  if (process.env.NODE_ENV !== 'production') return null;
  const checks = await getProductionReadinessChecks();
  const requiredChecks: Array<keyof ProductionReadinessChecks> = [
    'database',
    'sessionSecret',
    'distributedRateLimit',
    'privacyNoticeApproved',
    'retentionPolicyApproved',
    'productionDataUseApproved',
    'branchMasterIntegrated',
    'fieldDeviceValidation',
  ];
  const missingChecks = requiredChecks.filter((check) => !checks[check]);
  if (missingChecks.length === 0) return null;

  return NextResponse.json(
    {
      error: 'Production data access is disabled until release approvals and operational controls are complete.',
      code: 'PRODUCTION_RELEASE_GATE_BLOCKED',
      blockedChecks: missingChecks,
    },
    { status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } }
  );
}
