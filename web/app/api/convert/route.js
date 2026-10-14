import { fail, guard, ok, readJson } from '../../../lib/http';
import { effectiveConverter } from '../../../lib/store';
import { isHttpUrl, runRemoteChain } from '../../../lib/converters';
import { textStats } from '../../../lib/text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** اگر کاربر یک تبدیل‌کننده‌ی خاص را انتخاب کرده باشد، فقط همان امتحان می‌شود */
function filterConverter(converter, provider) {
  const id = String(provider || 'auto').toLowerCase();
  if (!id || id === 'auto') return converter;
  return {
    ...converter,
    jinaEnabled: id === 'jina',
    markerApiKey: id === 'marker' ? converter.markerApiKey : '',
    mistralApiKey: id === 'mistral' ? converter.mistralApiKey : '',
  };
}

function providerHint(converter, url, hasFile) {
  if (hasFile && !converter.markerApiKey && !converter.mistralApiKey) {
    return 'برای تبدیل آنلاین فایل، کلید یکی از سرویس‌ها (Datalab Marker یا Mistral OCR) را در پنل ثبت کنید.';
  }
  if (url && !converter.jinaEnabled) return 'تبدیل‌کننده‌ی Jina در پنل خاموش است.';
  return 'تبدیل آنلاین ناموفق بود؛ تبدیل محلی در مرورگر انجام می‌شود.';
}

/** تبدیل آنلاین سند به Markdown (لینک و/یا فایل کمتر از ۴ مگابایت) */
export async function POST(request) {
  const { state, error } = await guard(request);
  if (error) return error;

  const contentType = String(request.headers.get('content-type') || '');
  const baseConverter = effectiveConverter(state);

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      const provider = String(form.get('provider') || 'auto');
      if (!file || typeof file === 'string') {
        return fail('فایلی برای تبدیل آنلاین ارسال نشد.', 400);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const converter = filterConverter(baseConverter, provider);
      const outcome = await runRemoteChain({
        file: { bytes, filename: String(file.name || 'document.pdf') },
        converter,
      });

      if (!outcome.ok) {
        return fail(providerHint(converter, '', true), 502, { notes: outcome.notes });
      }
      const stats = textStats(outcome.markdown, []);
      return ok({
        provider: outcome.provider,
        markdown: outcome.markdown,
        chars: stats.chars,
        notes: outcome.notes,
      });
    }

    const body = await readJson(request);
    const url = String(body?.url || '').trim();
    const provider = String(body?.provider || 'auto');
    if (!url) return fail('لینک مقاله/کتاب را وارد کنید.', 400);
    if (!isHttpUrl(url)) return fail('لینک باید با http یا https شروع شود.', 400);

    const converter = filterConverter(baseConverter, provider || (body?.urlOnly ? 'jina' : 'auto'));
    if (provider === 'auto' && !converter.jinaEnabled && !converter.markerApiKey && !converter.mistralApiKey) {
      // اگر هیچ گزینه‌ای نبود، Jina را امتحان می‌کنیم (رایگان است)
      converter.jinaEnabled = true;
    }

    const outcome = await runRemoteChain({ url, converter });
    if (!outcome.ok) {
      return fail(providerHint(converter, url, false), 502, { notes: outcome.notes });
    }
    const stats = textStats(outcome.markdown, []);
    return ok({
      provider: outcome.provider,
      markdown: outcome.markdown,
      chars: stats.chars,
      notes: outcome.notes,
    });
  } catch (conversionError) {
    return fail(`تبدیل آنلاین ناموفق بود — ${conversionError?.message || 'خطای نامشخص'}`, 500);
  }
}
