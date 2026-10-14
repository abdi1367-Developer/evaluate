/**
 * تبدیل سند به Markdown با سرویس‌های آنلاین — فقط سمت سرور.
 *
 *  • Jina Reader  → رایگان و بدون کلید؛ برای «لینک» (مقاله‌ی آنلاین، arXiv، PDF روی وب)
 *  • Datalab Marker → نیازمند کلید (در پنل ثبت می‌شود)؛ برای آپلود فایل
 *  • Mistral OCR  → نیازمند کلید (در پنل ثبت می‌شود)؛ مناسب PDF اسکن‌شده/تصویری
 *
 * ترتیب: هر گزینه‌ای که کلیدش موجود باشد امتحان می‌شود و در صورت موفقیت،
 * خروجی Markdown به مرورگر برمی‌گردد. اگر هیچ‌کدام موفق نشد، تبدیل محلی
 * (pdf.js / docx در مرورگر) انجام می‌شود.
 */
import { normalizeMarkdown } from './text';

export const REMOTE_PROVIDERS = [
  { id: 'jina', label: 'Jina Reader — رایگان، بدون کلید (فقط لینک)' },
  { id: 'marker', label: 'Datalab Marker — نیازمند کلید (آپلود فایل)' },
  { id: 'mistral', label: 'Mistral OCR — نیازمند کلید (PDF اسکن‌شده)' },
];

const MAX_REMOTE_BYTES = 4 * 1024 * 1024; // سقف بدنه‌ی درخواست روی Vercel

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aborter(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** سرصفحه‌های متادیتای Jina را از ابتدای متن حذف می‌کند */
function stripJinaPreamble(text) {
  const lines = String(text || '').split('\n');
  let index = 0;
  while (index < lines.length && /^(Title|URL Source|Published Time|Description|Markdown Content|Warning):/i.test(lines[index].trim())) {
    index += 1;
  }
  return lines.slice(index).join('\n').trim();
}

/** تبدیل یک لینک (صفحه‌ی وب یا PDF آنلاین) به Markdown با Jina Reader */
export async function fetchUrlAsMarkdown({ url, apiKey = '', timeoutMs = 50000 }) {
  if (!isHttpUrl(url)) throw new Error('لینک باید با http یا https شروع شود.');
  const response = await fetch(`https://r.jina.ai/${String(url).trim()}`, {
    headers: {
      Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.5',
      'X-Return-Format': 'markdown',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    cache: 'no-store',
    signal: aborter(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = String(text || '').replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`Jina Reader پاسخ ${response.status} داد${detail ? ` — ${detail}` : ''}`);
  }
  const clean = stripJinaPreamble(text);
  if (!clean) throw new Error('Jina Reader متنی برنگرداند.');
  return clean;
}

export function assertRemoteFileSize(bytes) {
  const size = Number(bytes?.length || 0);
  if (size > MAX_REMOTE_BYTES) {
    throw new Error(
      `برای تبدیل آنلاین، حجم فایل باید کمتر از ${Math.round(MAX_REMOTE_BYTES / 1024 / 1024)} مگابایت باشد؛ ` +
        'برای فایل‌های بزرگ‌تر تبدیل محلی در مرورگر استفاده کنید.'
    );
  }
}

/** تبدیل فایل با Datalab Marker (نیازمند کلید) */
export async function markerConvertFile({ bytes, filename, apiKey, onProgress = () => {}, timeoutMs = 52000 }) {
  if (!apiKey) throw new Error('برای Datalab Marker باید کلید در پنل ثبت شود.');
  assertRemoteFileSize(bytes);

  const started = Date.now();
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename || 'document.pdf');
  form.append('output_format', 'markdown');
  form.append('force_ocr', 'false');

  const response = await fetch('https://www.datalab.to/api/v1/marker', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
    cache: 'no-store',
    signal: aborter(timeoutMs),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    const detail = String(payload?.error || payload?.detail || response.status).slice(0, 180);
    throw new Error(`Marker ناموفق بود — ${detail}`);
  }
  if (typeof payload?.markdown === 'string' && payload.markdown.trim()) return payload.markdown.trim();

  const checkUrl = payload?.request_check_url;
  if (!checkUrl) throw new Error('پاسخ Marker قابل تفسیر نبود.');

  while (Date.now() - started < timeoutMs) {
    await sleep(2500);
    onProgress('در انتظار آماده‌شدن خروجی Marker …');
    const check = await fetch(checkUrl, {
      headers: { 'X-Api-Key': apiKey },
      cache: 'no-store',
      signal: aborter(15000),
    });
    const info = await check.json().catch(() => null);
    if (typeof info?.markdown === 'string' && info.markdown.trim()) return info.markdown.trim();
    const status = String(info?.status || '').toLowerCase();
    if (status === 'failed' || status === 'error') {
      throw new Error(`Marker پردازش را ناتمام گذاشت — ${String(info?.error || status).slice(0, 160)}`);
    }
  }
  throw new Error('زمان انتظار برای خروجی Marker به پایان رسید.');
}

/** تبدیل فایل (به‌ویژه PDF اسکن‌شده) با Mistral OCR (نیازمند کلید) */
export async function mistralConvertFile({ bytes, filename, apiKey, timeoutMs = 52000 }) {
  if (!apiKey) throw new Error('برای Mistral OCR باید کلید در پنل ثبت شود.');
  assertRemoteFileSize(bytes);

  const isPdf = /\.pdf$/i.test(String(filename || ''));
  const mime = isPdf ? 'application/pdf' : 'application/octet-stream';
  const base64 = Buffer.from(bytes).toString('base64');

  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: `data:${mime};base64,${base64}` },
      include_image_base64: false,
    }),
    cache: 'no-store',
    signal: aborter(timeoutMs),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = String(payload?.message || payload?.error || response.status).slice(0, 180);
    throw new Error(`Mistral OCR ناموفق بود — ${detail}`);
  }
  const pages = Array.isArray(payload?.pages) ? payload.pages : [];
  const markdown = pages
    .map((page) => String(page?.markdown || '').trim())
    .filter(Boolean)
    .join('\n\n---\n\n');
  if (!markdown.trim()) throw new Error('Mistral OCR متنی استخراج نکرد.');
  return markdown;
}

/**
 * زنجیره‌ی تبدیل آنلاین: هر گزینه‌ای که امکانش باشد امتحان می‌شود.
 * @returns {Promise<{ok: boolean, markdown: string, provider: string, notes: string[]}>}
 */
export async function runRemoteChain({ url, file, converter, onProgress = () => {} }) {
  const notes = [];
  const attempts = [];

  if (url && converter.jinaEnabled) {
    attempts.push({
      id: 'jina',
      label: 'Jina Reader (رایگان)',
      run: () => fetchUrlAsMarkdown({ url, apiKey: converter.jinaApiKey }),
    });
  }
  if (file && converter.markerApiKey) {
    attempts.push({
      id: 'marker',
      label: 'Datalab Marker',
      run: () => markerConvertFile({ ...file, apiKey: converter.markerApiKey, onProgress }),
    });
  }
  if (file && converter.mistralApiKey) {
    attempts.push({
      id: 'mistral',
      label: 'Mistral OCR',
      run: () => mistralConvertFile({ ...file, apiKey: converter.mistralApiKey }),
    });
  }

  for (const attempt of attempts) {
    try {
      onProgress(`تلاش برای تبدیل آنلاین با ${attempt.label} …`);
      const markdown = normalizeMarkdown(await attempt.run());
      if (markdown.trim()) {
        return { ok: true, markdown, provider: attempt.id, notes };
      }
      notes.push(`${attempt.label}: خروجی خالی بود.`);
    } catch (error) {
      notes.push(`${attempt.label}: ${error?.message || 'ناموفق بود'}`);
    }
  }

  return { ok: false, markdown: '', provider: '', notes };
}

