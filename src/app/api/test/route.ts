import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}

export async function POST() {
  return NextResponse.json({ ok: true, method: 'POST', time: new Date().toISOString() });
}
