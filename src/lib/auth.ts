import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

function getJwtSecret(): string {
  const configuredSecret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!configuredSecret || configuredSecret.length < 32)) {
    throw new Error('JWT_SECRET must contain at least 32 characters in production.');
  }
  return configuredSecret || 'local-development-only-msme-jwt-secret';
}

export interface AuthSessionUser {
  userId: string;
  email: string;
  name: string;
  role: 'OFFICER' | 'MANAGER';
  assignedPincode: string;
}

export function signToken(user: AuthSessionUser): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: '8h' });
}

export function verifyToken(token: string): AuthSessionUser | null {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (typeof payload !== 'object' || payload === null) return null;
    const candidate = payload as Record<string, unknown>;
    if (
      typeof candidate.userId !== 'string'
      || typeof candidate.email !== 'string'
      || typeof candidate.name !== 'string'
      || (candidate.role !== 'OFFICER' && candidate.role !== 'MANAGER')
      || typeof candidate.assignedPincode !== 'string'
    ) return null;

    return {
      userId: candidate.userId,
      email: candidate.email,
      name: candidate.name,
      role: candidate.role,
      assignedPincode: candidate.assignedPincode,
    };
  } catch {
    return null;
  }
}

export async function getCurrentUserFromHeadersOrCookies(req?: Request): Promise<AuthSessionUser | null> {
  let token: string | undefined;
  // 1. Try Authorization header
  if (req) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  // 2. Try Next.js cookies
  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get('auth_token')?.value;
    } catch {
      // Cookie access is unavailable outside a Next.js request context.
    }
  }

  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims) return null;
  if (process.env.NODE_ENV !== 'production') return claims;

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, name: true, role: true, assigned_pincode: true },
  });
  if (!user || (user.role !== 'OFFICER' && user.role !== 'MANAGER')) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    assignedPincode: user.assigned_pincode,
  };
}
