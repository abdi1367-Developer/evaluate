/**
 * ابزارهای مشترک مسیرهای API — فقط سمت سرور.
 */
import { getState } from './store';
import { SESSION_COOKIE, parseCookies, readSessionToken } from './auth';

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload ?? {}), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function fail(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export function ok(payload = {}, status = 200, headers = {}) {
  return json({ ok: true, ...payload }, status, headers);
}

export function clientIp(request) {
  const header =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    '';
  return String(header).split(',')[0].trim() || 'local';
}

export async function readJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** نشست جاری از روی کوکی؛ null اگر نامعتبر/منقضی باشد */
export async function currentSession(request, state) {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return readSessionToken(token, state?.secret || '');
}

/** نگهبان مسیرهای محافظت‌شده: { state, session } یا { error: Response } */
export async function guard(request) {
  const state = await getState();
  const session = await currentSession(request, state);
  if (!session || !state?.auth) {
    return { error: fail('دسترسی غیرمجاز — ابتدا وارد حساب خود شوید.', 401) };
  }
  return { state, session };
}

/** مقدار محرمانه‌ی دریافتی از پنل را تفسیر می‌کند: «خالی» و «ماسک‌شده» یعنی دست نزن */
export function incomingSecret(value, existing) {
  if (value === undefined || value === null) return existing || '';
  const text = String(value).trim();
  if (!text) return existing || '';
  if (text.includes('•') || text.includes('*')) return existing || '';
  return text;
}
