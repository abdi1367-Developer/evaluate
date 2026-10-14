import { guard, json } from '../../../../lib/http';
import { publicAccount, publicSettings, statusPayload } from '../../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** وضعیت نشست + تنظیمات امن (بدون کلید کامل) برای رابط کاربری */
export async function GET(request) {
  const { state, error } = await guard(request);
  if (error) return error;

  return json({
    ok: true,
    authenticated: true,
    account: publicAccount(state),
    settings: publicSettings(state),
    status: statusPayload(state),
  });
}
