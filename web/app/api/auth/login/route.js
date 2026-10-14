import { clientIp, fail, ok, readJson } from '../../../../lib/http';
import {
  clearLoginFailures,
  createSessionToken,
  loginBlocked,
  normalizeMobile,
  registerLoginFailure,
  sessionCookieHeader,
  toAsciiDigits,
  verifyPassword,
} from '../../../../lib/auth';
import { getState } from '../../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ورود با شماره موبایل یا نام کاربری + رمز عبور */
export async function POST(request) {
  const body = await readJson(request);
  const identifier = String(body?.identifier || '').trim();
  const password = String(body?.password || '');

  if (!identifier || !password) {
    return fail('شماره موبایل/نام کاربری و رمز عبور را وارد کنید.', 400);
  }

  const ip = clientIp(request);
  const guardKey = `${ip}:${identifier.toLowerCase()}`;
  const wait = loginBlocked(guardKey);
  if (wait) {
    return fail(`تلاش‌های ناموفق زیاد بوده است؛ ${wait} ثانیه دیگر دوباره تلاش کنید.`, 429);
  }

  const state = await getState({ fresh: true });
  const auth = state?.auth || {};
  if (!auth.salt || !auth.hash) {
    return fail('حساب کاربری روی سرور تنظیم نشده است.', 500);
  }

  // همیشه هش محاسبه می‌شود تا زمان پاسخ لو ندهد کدام فیلد نادرست است
  const passwordOk = verifyPassword(password, auth.salt, auth.hash);
  const typed = toAsciiDigits(identifier).trim().toLowerCase();
  const identifierOk =
    typed === String(auth.username || '').trim().toLowerCase() ||
    normalizeMobile(typed) === normalizeMobile(auth.mobile) ||
    typed === String(auth.mobile || '').trim();

  if (!passwordOk || !identifierOk) {
    registerLoginFailure(guardKey);
    return fail('شماره موبایل/نام کاربری یا رمز عبور نادرست است.', 401);
  }

  if (state.storageWarning) {
    // فقط هشدار؛ ورود انجام می‌شود
    console.warn('[auth] storage warning:', state.storageWarning);
  }

  clearLoginFailures(guardKey);
  auth.updatedAt = auth.updatedAt || new Date().toISOString();
  const token = createSessionToken({ username: auth.username, mobile: auth.mobile }, state.secret);

  return ok(
    { username: auth.username, mobile: auth.mobile },
    200,
    { 'Set-Cookie': sessionCookieHeader(token) }
  );
}
