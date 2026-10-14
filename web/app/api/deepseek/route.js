/**
 * مسیر امن ارتباط با DeepSeek.
 *
 * چرا واسطه لازم است؟
 * ۱) کلید API روی سرور (Environment Variable) می‌ماند و هرگز به مرورگر نمی‌رود.
 * ۲) مرورگر نمی‌تواند مستقیم به api.deepseek.com درخواست بزند (CORS).
 *
 * متغیرهای محیطی لازم (روی Vercel: Settings → Environment Variables):
 *   DEEPSEEK_API_KEY  (اجباری)
 *   APP_PASSWORD      (اختیاری ولی توصیه‌شده؛ رمز دسترسی سایت)
 *   DEEPSEEK_BASE_URL (اختیاری)
 *   DEEPSEEK_MODEL    (اختیاری)
 */

export const runtime = 'nodejs';
// سقف زمان اجرا در Vercel (پلن Hobby حداکثر ۶۰ ثانیه)
export const maxDuration = 60;

const MODELS = ['deepseek-chat', 'deepseek-reasoner'];
const MAX_TOTAL_CHARS = 400000; // محافظت از مصرف بی‌رویه
const UPSTREAM_TIMEOUT_MS = 55000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

/** ترجمه‌ی خطای دیپ‌سیک به پیام فارسی */
function upstreamMessage(status, bodyText) {
  const detail = String(bodyText || '').slice(0, 300);
  if (status === 401) return 'کلید API دیپ‌سیک نامعتبر است (خطای 401). مقدار DEEPSEEK_API_KEY را بررسی کنید.';
  if (status === 402) return 'اعتبار حساب دیپ‌سیک کافی نیست (خطای 402). حساب را شارژ کنید.';
  if (status === 400) return `درخواست نامعتبر بود (خطای 400): ${detail}`;
  if (status === 429) return 'محدودیت نرخ درخواست دیپ‌سیک (خطای 429). چند لحظه بعد دوباره تلاش کنید.';
  return `خطای دیپ‌سیک (${status}): ${detail}`;
}

/** وضعیت سرور برای نمایش در رابط کاربری */
export async function GET() {
  const apiKey = env('DEEPSEEK_API_KEY');
  const model = env('DEEPSEEK_MODEL', 'deepseek-chat');
  return jsonResponse({
    ready: Boolean(apiKey),
    needsPassword: Boolean(env('APP_PASSWORD')),
    defaultModel: MODELS.includes(model) ? model : 'deepseek-chat',
    models: MODELS,
  });
}

export async function POST(request) {
  const apiKey = env('DEEPSEEK_API_KEY');
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          'کلید DEEPSEEK_API_KEY روی سرور تنظیم نشده است. روی Vercel آن را در ' +
          'Settings → Environment Variables وارد کنید و پروژه را دوباره دیپلوی کنید.',
      },
      500
    );
  }

  const requiredPassword = env('APP_PASSWORD');
  if (requiredPassword && String(request.headers.get('x-app-password') || '').trim() !== requiredPassword) {
    return jsonResponse({ error: 'رمز دسترسی نادرست است.' }, 401);
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'بدنه‌ی درخواست خوانده نشد.' }, 400);
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) {
    return jsonResponse({ error: 'پیامی برای ارسال وجود ندارد.' }, 400);
  }

  const totalChars = messages.reduce((sum, message) => sum + String(message?.content || '').length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return jsonResponse(
      { error: `متن ارسالی بسیار بزرگ است (${totalChars} کاراکتر). سقف کاراکتر را کم کنید.` },
      413
    );
  }

  const requested = String(body?.model || '').trim();
  const model = MODELS.includes(requested) ? requested : env('DEEPSEEK_MODEL', 'deepseek-chat');
  const payload = {
    model: MODELS.includes(model) ? model : 'deepseek-chat',
    messages,
    stream: false,
  };

  // مدل reasoner از temperature و response_format پشتیبانی نمی‌کند
  if (!payload.model.startsWith('deepseek-reasoner')) {
    payload.temperature = 0.2;
    if (body?.jsonMode) payload.response_format = { type: 'json_object' };
  }

  const baseUrl = env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      const status = response.status === 401 || response.status === 402 || response.status === 429 ? response.status : 502;
      return jsonResponse({ error: upstreamMessage(response.status, raw) }, status);
    }

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: 'پاسخ دیپ‌سیک خوانده نشد (JSON نامعتبر).' }, 502);
    }

    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      return jsonResponse(
        { error: 'مدل پاسخ متنی نداد؛ ممکن است متن ورودی بیش از حد مجاز بوده باشد.' },
        502
      );
    }

    return jsonResponse({ content, model: payload.model, usage: data?.usage || null });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return jsonResponse(
        {
          error:
            'پاسخ دیپ‌سیک طول کشید و مهلت (۵۵ ثانیه) تمام شد. حجم متن یا تعداد بخش‌ها را کم کنید ' +
            'یا مدل را روی deepseek-chat بگذارید.',
        },
        504
      );
    }
    return jsonResponse({ error: `عدم دسترسی به سرویس دیپ‌سیک: ${error?.message || error}` }, 502);
  } finally {
    clearTimeout(timer);
  }
}
