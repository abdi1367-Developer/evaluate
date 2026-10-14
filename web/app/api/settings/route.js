import { fail, guard, incomingSecret, json, ok, readJson } from '../../../lib/http';
import { ensureSectionMap } from '../../../lib/sections';
import { safeModel } from '../../../lib/models';
import {
  effectiveConverter,
  publicSettings,
  saveState,
  statusPayload,
  storageIsPersistent,
  storageMode,
} from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** خواندن تنظیمات (کلیدها فقط به شکل ماسک‌شده برمی‌گردند) */
export async function GET(request) {
  const { state, error } = await guard(request);
  if (error) return error;
  return json({ ok: true, settings: publicSettings(state), status: statusPayload(state) });
}

/** ذخیره‌ی تنظیمات: کلید دیپ‌سیک، مدل، تبدیل‌کننده‌ها و سرفصل‌های پیش‌فرض */
export async function POST(request) {
  const { state, error } = await guard(request);
  if (error) return error;

  const body = await readJson(request);
  if (!body) return fail('اطلاعات ارسالی نامعتبر است.', 400);

  const settings = state.settings || (state.settings = {});

  if ('deepseekApiKey' in body) {
    const incoming = incomingSecret(body.deepseekApiKey, settings.deepseekApiKey);
    if (incoming !== String(settings.deepseekApiKey || '')) {
      settings.deepseekApiKey = incoming;
      settings.deepseekActive = false; // کلید جدید باید اول با «تست اتصال» تأیید شود
      settings.deepseekVerifiedAt = '';
    }
  }

  if ('deepseekBaseUrl' in body) {
    const url = String(body.deepseekBaseUrl || '').trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return fail('آدرس پایه‌ی دیپ‌سیک باید با http یا https شروع شود.', 400);
    }
    settings.deepseekBaseUrl = url.replace(/\/+$/, '') || 'https://api.deepseek.com';
  }

  if ('deepseekModel' in body) settings.deepseekModel = safeModel(body.deepseekModel);

  if (body.activate === true) {
    if (!String(settings.deepseekApiKey || '').trim()) {
      return fail('برای فعال‌سازی، اول کلید API را وارد کنید.', 400);
    }
    settings.deepseekActive = true;
    settings.deepseekVerifiedAt = new Date().toISOString();
  } else if (body.activate === false) {
    settings.deepseekActive = false;
  }

  if (body.converter && typeof body.converter === 'object') {
    const current = effectiveConverter(state);
    const incoming = body.converter;
    settings.converter = {
      mode: ['smart', 'local', 'online'].includes(incoming.mode) ? incoming.mode : current.mode,
      structureWithAI:
        incoming.structureWithAI === undefined ? current.structureWithAI : Boolean(incoming.structureWithAI),
      jinaEnabled: incoming.jinaEnabled === undefined ? current.jinaEnabled : Boolean(incoming.jinaEnabled),
      jinaApiKey: incomingSecret(incoming.jinaApiKey, current.jinaApiKey),
      markerApiKey: incomingSecret(incoming.markerApiKey, current.markerApiKey),
      mistralApiKey: incomingSecret(incoming.mistralApiKey, current.mistralApiKey),
    };
  }

  if (body.expectedSections && typeof body.expectedSections === 'object') {
    settings.expectedSections = ensureSectionMap(body.expectedSections);
  }

  const saved = await saveState(state);
  if (!saved.ok) return fail(`ذخیره‌ی تنظیمات ناموفق بود: ${saved.error}`, 500);

  return ok({
    settings: publicSettings(state),
    status: statusPayload(state),
    storage: { mode: storageMode(), persistent: storageIsPersistent() },
  });
}
