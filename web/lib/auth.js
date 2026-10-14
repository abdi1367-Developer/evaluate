/**
 * احراز هویت — فقط سمت سرور.
 * هش رمز با scrypt، نشست با HMAC-SHA256 (کوکی HttpOnly) و اعتبارسنجی ورودی‌ها.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'pe_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // یک هفته

const PERSIAN_DIGITS = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

export function toAsciiDigits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, (digit) => PERSIAN_DIGITS[digit] || digit);
}

/** شماره‌ی موبایل را به شکل استاندارد 09xxxxxxxxx برمی‌گرداند */
export function normalizeMobile(value) {
  let digits = toAsciiDigits(value).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0098')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('98') && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && digits.startsWith('9')) digits = `0${digits}`;
  return digits;
}

export function isValidMobile(value) {
  return /^09\d{9}$/.test(normalizeMobile(value));
}

export function maskMobile(value) {
  const digits = normalizeMobile(value);
  return /^09\d{9}$/.test(digits) ? `${digits.slice(0, 4)}***${digits.slice(-4)}` : '***';
}

export function isValidUsername(value) {
  const text = String(value ?? '').trim();
  return text.length >= 3 && text.length <= 32 && !/\s/.test(text);
}

export function isValidPassword(value) {
  const text = String(value ?? '');
  return text.length >= 6 && text.length <= 100;
}

export function makeSalt() {
  return randomBytes(16).toString('hex');
}

export function hashPassword(password, salt) {
  return scryptSync(String(password), String(salt), 32).toString('hex');
}

export function verifyPassword(password, salt, hash) {
  const expected = Buffer.from(String(hash || ''), 'hex');
  if (!expected.length) return false;
  let computed;
  try {
    computed = Buffer.from(hashPassword(password, salt), 'hex');
  } catch {
    return false;
  }
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

function base64url(text) {
  return Buffer.from(String(text), 'utf8').toString('base64url');
}

function signature(payload, secret) {
  return createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

export function createSessionToken(account, secret, ttlSeconds = SESSION_TTL_SECONDS) {
  const payload = base64url(
    JSON.stringify({
      u: String(account?.username || ''),
      m: String(account?.mobile || ''),
      exp: Date.now() + ttlSeconds * 1000,
    })
  );
  return `${payload}.${signature(payload, secret)}`;
}

export function readSessionToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !secret) return null;
  const given = Buffer.from(parts[1]);
  const expected = Buffer.from(signature(parts[0], secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!data?.exp || Number(data.exp) < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name) out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookieHeader(token, { maxAge = SESSION_TTL_SECONDS } = {}) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader() {
  return sessionCookieHeader('', { maxAge: 0 });
}

/** محدودکننده‌ی ساده‌ی تلاش ورود (در حافظه‌ی پروسه) */
const failures = new Map();

export function loginBlocked(key, limit = 8, windowMs = 10 * 60 * 1000) {
  const record = failures.get(key);
  if (!record) return 0;
  if (Date.now() - record.at > windowMs) {
    failures.delete(key);
    return 0;
  }
  return record.count >= limit ? Math.ceil((windowMs - (Date.now() - record.at)) / 1000) : 0;
}

export function registerLoginFailure(key) {
  const record = failures.get(key);
  const at = Date.now();
  failures.set(key, { count: (record?.count || 0) + 1, at });
}

export function clearLoginFailures(key) {
  failures.delete(key);
}
