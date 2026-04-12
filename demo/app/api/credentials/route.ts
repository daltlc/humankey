import { NextResponse } from 'next/server';
import { getCredentialList } from '@/lib/humankey-config';

export async function GET() {
  return NextResponse.json({ credentials: getCredentialList() });
}
