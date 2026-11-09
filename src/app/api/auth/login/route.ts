import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

const DEMO_ACCOUNT_EMAILS = new Set([
  'officer@msmelender.in',
  'manager@msmelender.in',
  'rahul@msmelender.in',
  'neha@msmelender.in',
  'imran@msmelender.in',
]);

export async function POST(req: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(req, 'login');
    if (rateLimitResponse) return rateLimitResponse;

    const body = await req.json();
    const result = LoginSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.issues },
        { status: 400 }
      );
    }

    const { email, password } = result.data;
    const normalizedEmail = email.trim().toLowerCase();
    const accountRateLimitResponse = await enforceRateLimit(req, 'login', normalizedEmail, false);
    if (accountRateLimitResponse) return accountRateLimitResponse;

    if (process.env.NODE_ENV === 'production' && password.length < 12) {
      return NextResponse.json(
        { error: 'Production passwords must be at least 12 characters. Contact your administrator to reset your credentials.' },
        { status: 400 }
      );
    }
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || (process.env.NODE_ENV === 'production' && DEMO_ACCOUNT_EMAILS.has(normalizedEmail))) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const sessionUser = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'OFFICER' | 'MANAGER',
      assignedPincode: user.assigned_pincode,
    };

    const token = signToken(sessionUser);

    const response = NextResponse.json({ success: true, user: sessionUser });
    response.headers.set('Cache-Control', 'no-store');

    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });

    return response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
