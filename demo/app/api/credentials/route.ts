import { NextResponse } from 'next/server';
import { getCredentialList, clearCredentials } from '@/lib/humankey-config';

export async function GET() {
  return NextResponse.json({ credentials: getCredentialList() });
}

export async function DELETE() {
  clearCredentials();
  return NextResponse.json({ ok: true });
}
