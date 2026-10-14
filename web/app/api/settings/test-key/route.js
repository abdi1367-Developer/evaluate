import { fail, guard, ok, readJson } from '../../../../lib/http';
import { resolveDeepseek } from '../../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * تست کلید دیپ‌سیک (در این مرحله فقط دیپ‌سیک).
 * ۱) فهرست مدل‌ها را می‌گیرد (اگر در دسترس باشد)
 * ۲) با یک درخواست کوچک، درستی کلید و دسترسی مدل را می‌سنجد
 */
export async function POST(request) {
  const { state, error } = await guard(request);
  if (error) return error;

  const body = (await readJson(request)) || {};
  const stored = resolveDeepseek(state);
  const apiKey = String(body.apiKey || '').trim() || stored.apiKey;
  const baseUrl = String(body.baseUrl || stored.baseUrl || 'https://api.deepseek.com')
    .trim()
    .replace(/\/+$/, '');
  const model = String(body.model || stored.model || 'deepseek-chat').trim();

  if (!apiKey) return fail('کلید API دیپ‌سیک را وارد کنید.', 400);
  if (!/^https?:\/\//i.test(baseUrl)) return fail('آدرس پایه‌ی سرویس معتبر نیست.', 400);

  const headers = { Authorization: `Bearer ${apiKey}` };
  const started = Date.now();
  let models = [];
  let listNote = '';

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      cache: 'no-store',
      signal: timeoutSignal(12000),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && Array.isArray(payload?.data)) {
      models = payload.data.map((item) => String(item?.id || '')).filter(Boolean);
    } else {
      listNote = `فهرست مدل‌ها در دسترس نبود (${response.status}).`;
    }
  } catch (listError) {
    listNote = `فهرست مدل‌ها خوانده نشد: ${listError?.message || 'ناموفق'}`;
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'سلام' }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
      cache: 'no-store',
      signal: timeoutSignal(22000),
    });
    const payload = await response.json().catch(() => null);
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `پاسخ ${response.status}`;
      return fail(`کلید تأیید نشد — ${message}`, 400, { status: response.status, models });
    }

    return ok({
      latencyMs,
      models,
      model,
      modelAvailable: !models.length || models.includes(model),
      note: listNote,
    });
  } catch (callError) {
    return fail(`ارتباط با دیپ‌سیک برقرار نشد — ${callError?.message || 'خطای شبکه'}`, 502);
  }
}
