import { NextResponse } from 'next/server';
import { sessionCookie } from '@/lib/city-auth';
import { guard } from '@/lib/server';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const block = guard(request);
  if (block) return block;
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({ ...sessionCookie(''), maxAge: 0 });
  return response;
}
