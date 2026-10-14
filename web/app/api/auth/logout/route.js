import { json } from '../../../../lib/http';
import { clearSessionCookieHeader } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** خروج: کوکی نشست پاک می‌شود */
export async function POST() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() });
}
