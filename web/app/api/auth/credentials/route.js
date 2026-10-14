import { fail, guard, ok, readJson } from '../../../../lib/http';
import {
  createSessionToken,
  hashPassword,
  isValidMobile,
  isValidPassword,
  isValidUsername,
  makeSalt,
  normalizeMobile,
  sessionCookieHeader,
  verifyPassword,
} from '../../../../lib/auth';
import { saveState, storageIsPersistent, storageMode } from '../../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** تغییر نام کاربری، شماره موبایل و رمز عبور از داخل پنل */
export async function POST(request) {
  const { state, error } = await guard(request);
  if (error) return error;

  const body = await readJson(request);
  if (!body) return fail('اطلاعات ارسالی نامعتبر است.', 400);

  const currentPassword = String(body.currentPassword || '');
  if (!verifyPassword(currentPassword, state.auth.salt, state.auth.hash)) {
    return fail('برای تغییر اطلاعات، رمز عبور فعلی را درست وارد کنید.', 403);
  }

  const nextUsername = String(body.username ?? state.auth.username).trim() || state.auth.username;
  const nextMobile = normalizeMobile(body.mobile ?? state.auth.mobile) || state.auth.mobile;
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');

  if (!isValidUsername(nextUsername)) {
    return fail('نام کاربری باید ۳ تا ۳۲ کاراکتر و بدون فاصله باشد.', 400);
  }
  if (!isValidMobile(nextMobile)) {
    return fail('شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: 09121234567).', 400);
  }
  if (newPassword) {
    if (!isValidPassword(newPassword)) return fail('رمز عبور جدید باید حداقل ۶ کاراکتر باشد.', 400);
    if (newPassword !== confirmPassword) return fail('تکرار رمز عبور جدید مطابقت ندارد.', 400);
  }

  state.auth.username = nextUsername;
  state.auth.mobile = nextMobile;
  if (newPassword) {
    state.auth.salt = makeSalt();
    state.auth.hash = hashPassword(newPassword, state.auth.salt);
    state.auth.isDefault = false;
  }
  state.auth.updatedAt = new Date().toISOString();

  const saved = await saveState(state);
  if (!saved.ok) return fail(`ذخیره‌ی اطلاعات حساب ناموفق بود: ${saved.error}`, 500);

  const token = createSessionToken(
    { username: state.auth.username, mobile: state.auth.mobile },
    state.secret
  );

  return ok(
    {
      username: state.auth.username,
      mobile: state.auth.mobile,
      storage: { mode: storageMode(), persistent: storageIsPersistent() },
    },
    200,
    { 'Set-Cookie': sessionCookieHeader(token) }
  );
}
