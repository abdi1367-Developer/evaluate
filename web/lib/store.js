/**
 * ذخیره‌سازی وضعیت برنامه (حساب کاربری + تنظیمات) — فقط سمت سرور.
 *
 * سه حالت پشتیبانی می‌شود:
 *  ۱) Vercel KV / Upstash Redis (REST) → تغییرات دائمی است (توصیه‌شده روی Vercel)
 *  ۲) فایل محلی .data/state.json       → دائمی در اجرای محلی (npm run dev)
 *  ۳) حافظه‌ی پروسه                    → موقت؛ با ری‌استارت پاک می‌شود
 *
 * متغیرهای محیطی مربوطه: KV_REST_API_URL / KV_REST_API_TOKEN
 *   (یا UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword, makeSalt, normalizeMobile } from './auth';
import { ensureSectionMap } from './sections';
import { DEFAULT_BASE_URL, DEFAULT_MODEL, MODELS } from './models';

const KV_KEY = 'paper-evaluator:state:v1';
const CACHE_MS = 4000;
const DEFAULT_USERNAME = 'admin';
const DEFAULT_MOBILE = '09120000000';
const DEFAULT_PASSWORD = 'admin1234';
const FILE_PATH = path.join(process.cwd(), '.data', 'state.json');

let cache = { state: null, at: 0 };

export function kvConfig() {
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const token = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return { url, token };
}

export function storageMode() {
  const { url, token } = kvConfig();
  if (url && token) return 'kv';
  if (process.env.VERCEL) return 'memory';
  return 'file';
}

export function storageIsPersistent() {
  const mode = storageMode();
  return mode === 'kv' || mode === 'file';
}

function initialState() {
  const salt = makeSalt();
  const password = String(process.env.APP_PASSWORD || DEFAULT_PASSWORD);
  const mobile = normalizeMobile(process.env.APP_MOBILE || DEFAULT_MOBILE);
  const username = String(process.env.APP_USERNAME || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME;
  const keyFromEnv = String(process.env.DEEPSEEK_API_KEY || '').trim();
  return {
    version: 1,
    secret: randomBytes(32).toString('hex'),
    auth: {
      username,
      mobile: /^09\d{9}$/.test(mobile) ? mobile : DEFAULT_MOBILE,
      salt,
      hash: hashPassword(password, salt),
      isDefault: !process.env.APP_PASSWORD || password === DEFAULT_PASSWORD,
      updatedAt: new Date().toISOString(),
    },
    settings: {
      deepseekApiKey: '',
      deepseekBaseUrl: String(process.env.DEEPSEEK_BASE_URL || '').trim() || DEFAULT_BASE_URL,
      deepseekModel: String(process.env.DEEPSEEK_MODEL || '').trim() || DEFAULT_MODEL,
      deepseekActive: false,
      deepseekVerifiedAt: keyFromEnv ? new Date().toISOString() : '',
      converter: {
        mode: 'smart',
        structureWithAI: true,
        jinaEnabled: true,
        jinaApiKey: '',
        markerApiKey: '',
        mistralApiKey: '',
      },
      expectedSections: ensureSectionMap(null),
    },
  };
}

async function readBackend() {
  const mode = storageMode();
  if (mode === 'kv') {
    const { url, token } = kvConfig();
    const response = await fetch(`${url}/get/${encodeURIComponent(KV_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`خواندن از Vercel KV ناموفق بود (${response.status}).`);
    const payload = await response.json().catch(() => null);
    const value = payload?.result;
    if (!value) return null;
    return typeof value === 'string' ? JSON.parse(value) : value;
  }
  if (mode === 'file') {
    try {
      return JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
  return null;
}

async function writeBackend(state) {
  const mode = storageMode();
  if (mode === 'kv') {
    const { url, token } = kvConfig();
    const response = await fetch(`${url}/set/${encodeURIComponent(KV_KEY)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=utf-8' },
      body: JSON.stringify(state),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`ذخیره در Vercel KV ناموفق بود (${response.status}).`);
    return;
  }
  if (mode === 'file') {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(state, null, 2), 'utf8');
  }
  // حالت memory: فقط در کش پروسه می‌ماند
}

export async function getState({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache.state && now - cache.at < CACHE_MS) return cache.state;

  let state = null;
  let warning = '';
  try {
    state = await readBackend();
  } catch (error) {
    warning = error?.message || 'دسترسی به محل ذخیره‌سازی ناموفق بود.';
  }

  if (!state || !state.auth || !state.secret) {
    state = initialState();
    try {
      await writeBackend(state);
    } catch (error) {
      warning = warning || error?.message || '';
    }
  }

  state.settings = state.settings || {};
  state.settings.expectedSections = ensureSectionMap(state.settings.expectedSections);
  if (warning) state.storageWarning = warning;
  cache = { state, at: Date.now() };
  return state;
}

export async function saveState(state) {
  delete state.storageWarning;
  cache = { state, at: Date.now() };
  try {
    await writeBackend(state);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'ذخیره‌سازی ناموفق بود.' };
  }
}

export function maskKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}••••`;
  return `${key.slice(0, 6)}••••••${key.slice(-4)}`;
}

/** تنظیمات به شکل امن برای مرورگر (هرگز کلید کامل فرستاده نمی‌شود) */
export function publicSettings(state) {
  const settings = state?.settings || {};
  const converter = effectiveConverter(state);
  const envKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  const stored = String(settings.deepseekApiKey || '').trim();
  return {
    deepseekBaseUrl: String(settings.deepseekBaseUrl || DEFAULT_BASE_URL),
    deepseekModel: String(settings.deepseekModel || DEFAULT_MODEL),
    deepseekActive: Boolean(settings.deepseekActive) && Boolean(stored),
    deepseekVerifiedAt: settings.deepseekVerifiedAt || '',
    deepseekKeyPreview: stored ? maskKey(stored) : envKey ? `${maskKey(envKey)} (متغیر محیطی)` : '',
    hasStoredKey: Boolean(stored),
    hasEnvKey: Boolean(envKey),
    converter: {
      mode: converter.mode,
      structureWithAI: converter.structureWithAI,
      jinaEnabled: converter.jinaEnabled,
      jinaKeyPreview: maskKey(converter.jinaApiKey),
      markerKeyPreview: maskKey(converter.markerApiKey),
      mistralKeyPreview: maskKey(converter.mistralApiKey),
      hasJinaKey: Boolean(converter.jinaApiKey),
      hasMarkerKey: Boolean(converter.markerApiKey),
      hasMistralKey: Boolean(converter.mistralApiKey),
    },
    expectedSections: ensureSectionMap(settings.expectedSections),
    models: MODELS,
  };
}

/** اطلاعات حساب به شکل امن برای مرورگر */
export function publicAccount(state) {
  const auth = state?.auth || {};
  const digits = normalizeMobile(auth.mobile);
  return {
    username: String(auth.username || ''),
    mobile: digits,
    mobileMasked: /^09\d{9}$/.test(digits) ? `${digits.slice(0, 4)}***${digits.slice(-4)}` : '***',
    isDefaultPassword: Boolean(auth.isDefault),
    updatedAt: auth.updatedAt || '',
  };
}

export function effectiveConverter(state) {
  const raw = state?.settings?.converter || {};
  return {
    mode: ['smart', 'local', 'online'].includes(raw.mode) ? raw.mode : 'smart',
    structureWithAI: raw.structureWithAI !== false,
    jinaEnabled: raw.jinaEnabled !== false,
    jinaApiKey: String(raw.jinaApiKey || '').trim(),
    markerApiKey: String(raw.markerApiKey || '').trim(),
    mistralApiKey: String(raw.mistralApiKey || '').trim(),
  };
}

/** کلید فعال دیپ‌سیک: اول کلید تأییدشده‌ی پنل، بعد متغیر محیطی */
export function resolveDeepseek(state) {
  const settings = state?.settings || {};
  const baseUrl =
    String(settings.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL)
      .trim()
      .replace(/\/+$/, '') || DEFAULT_BASE_URL;
  const model = String(settings.deepseekModel || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const stored = String(settings.deepseekApiKey || '').trim();
  const envKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (stored && settings.deepseekActive) return { apiKey: stored, baseUrl, model, source: 'panel', ready: true };
  if (envKey) return { apiKey: envKey, baseUrl, model, source: 'env', ready: true };
  if (stored) return { apiKey: stored, baseUrl, model, source: 'panel-unverified', ready: false };
  return { apiKey: '', baseUrl, model, source: 'none', ready: false };
}

/** وضعیت خلاصه برای نمایش در رابط کاربری */
export function statusPayload(state) {
  const deepseek = resolveDeepseek(state);
  return {
    ready: deepseek.ready,
    source: deepseek.source,
    model: deepseek.model,
    baseUrl: deepseek.baseUrl,
    models: MODELS,
    storageMode: storageMode(),
    persistent: storageIsPersistent(),
    storageWarning: state?.storageWarning || '',
    hasEnvKey: Boolean(String(process.env.DEEPSEEK_API_KEY || '').trim()),
  };
}

