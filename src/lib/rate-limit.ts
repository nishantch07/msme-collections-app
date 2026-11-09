import { createHash } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

type LimitPolicy = {
  requests: number;
  window: `${number} ${'s' | 'm' | 'h'}`;
};

const policies: Record<string, LimitPolicy> = {
  login: { requests: 10, window: '15 m' },
  import: { requests: 5, window: '1 h' },
  sync: { requests: 30, window: '1 m' },
  contact: { requests: 60, window: '1 m' },
  write: { requests: 60, window: '1 m' },
  ai: { requests: 20, window: '1 m' },
  read: { requests: 120, window: '1 m' },
  metrics: { requests: 30, window: '1 m' },
};

const limiters = new Map<string, Ratelimit>();
let redis: Redis | null = null;

const unavailable = () =>
  NextResponse.json(
    { error: 'Request protection is temporarily unavailable. Try again later.' },
    { status: 503, headers: { 'Retry-After': '60' } }
  );

function getClientAddress(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const forwardedAddresses = forwardedFor?.split(',').map((address) => address.trim()).filter(Boolean);
  return (forwardedAddresses?.length ? forwardedAddresses[forwardedAddresses.length - 1] : null)
    || request.headers.get('x-real-ip')
    || null;
}

export async function enforceRateLimit(
  request: Request,
  policyName: keyof typeof policies,
  identity?: string,
  includeClientAddress = true
): Promise<NextResponse | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') return unavailable();
    return null;
  }

  const policy = policies[policyName];
  if (!policy) throw new Error(`Unknown rate-limit policy: ${policyName}`);
  const clientAddress = getClientAddress(request);
  if (!clientAddress && process.env.NODE_ENV === 'production') {
    console.error('Rate limiter rejected request without a trusted client address.');
    return unavailable();
  }

  try {
    redis ??= new Redis({ url, token });
    const limiterKey = `${policyName}:${policy.requests}:${policy.window}`;
    let limiter = limiters.get(limiterKey);
    if (!limiter) {
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(policy.requests, policy.window),
        prefix: 'msme-collections',
      });
      limiters.set(limiterKey, limiter);
    }

    const keys = includeClientAddress ? [`${policyName}:ip:${clientAddress || 'development'}`] : [];
    if (identity) {
      const identityHash = createHash('sha256').update(identity.trim().toLowerCase()).digest('hex');
      keys.push(`${policyName}:identity:${identityHash}`);
    }
    if (keys.length === 0) throw new Error('Rate-limit request requires an IP or identity scope.');

    for (const key of keys) {
      const result = await limiter.limit(key);
      if (result.success) continue;

      const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfterSeconds.toString(),
            'RateLimit-Limit': result.limit.toString(),
            'RateLimit-Remaining': result.remaining.toString(),
            'RateLimit-Reset': Math.ceil(result.reset / 1000).toString(),
          },
        }
      );
    }
    return null;
  } catch (error) {
    console.error('Distributed rate limiter unavailable:', error);
    return unavailable();
  }
}
