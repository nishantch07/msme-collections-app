import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-msme-jwt-key-2026-bengaluru';

export interface AuthSessionUser {
  userId: string;
  email: string;
  name: string;
  role: 'OFFICER' | 'MANAGER';
  assignedPincode: string;
}

export function signToken(user: AuthSessionUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthSessionUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthSessionUser;
  } catch {
    return null;
  }
}

export async function getCurrentUserFromHeadersOrCookies(req?: Request): Promise<AuthSessionUser | null> {
  // 1. Try Authorization header
  if (req) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const user = verifyToken(token);
      if (user) return user;
    }
  }

  // 2. Try Next.js cookies
  try {
    const cookieStore = cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (token) {
      return verifyToken(token);
    }
  } catch {
    // cookies() might fail if outside request context
  }

  return null;
}
