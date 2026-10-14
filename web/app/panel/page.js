'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  fetchSessionQuiet,
  logout as logoutRequest,
  saveSettings,
  testDeepseekKey,
  updateCredentials,
} from '../../lib/api-client';
import { DOC_TYPES, defaultGroupsFor, itemsToText, parseItemsText } from '../../lib/sections';
import { MODELS } from '../../lib/models';

const STORAGE_LABELS = {
  kv: 'Vercel KV / Upstash Redis — دائمی ✅',
  file: 'فایل محلی .data/state.json — دائمی در اجرای محلی ✅',
  memory: 'حافظه‌ی موقت پروسه — تغییرات پس از ری‌استارت پاک می‌شود ⚠️',
};

const MODE_OPTIONS = [
  { value: 'smart', label: 'هوشمند: اول آنلاین، در صورت نبود امکان محلی' },
  { value: 'local', label: 'فقط محلی (مرورگر)' },
  { value: 'online', label: 'فقط آنلاین (سرویس‌های ابری)' },
];

function buildSectionForm(map) {
  const out = {};
  for (const type of DOC_TYPES) {
    const groups = (map && map[type.id]) || defaultGroupsFor(type.id);
    out[type.id] = groups.map((group) => ({
      id: group.id,
      title: group.title,
      text: itemsToText(group.items),
    }));
  }
  return out;
}

export default function PanelPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [account, setAccount] = useState(null);
  const [notice, setNotice] = useState({ kind: 'info', text: '' });
  const [busy, setBusy] = useState('');
  const [accountForm, setAccountForm] = useState({
    username: '',
    mobile: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [deepseekForm, setDeepseekForm] = useState({ apiKey: '', baseUrl: '', model: 'deepseek-chat' });
  const [converterForm, setConverterForm] = useState({
    mode: 'smart',
    structureWithAI: true,
    jinaEnabled: true,
    jinaApiKey: '',
    markerApiKey: '',
    mistralApiKey: '',
  });
  const [sectionForm, setSectionForm] = useState({});
  const [sectionType, setSectionType] = useState('article');

  const applySession = useCallback((data) => {
    setStatus(data.status);
    setSettings(data.settings);
    setAccount(data.account);
    setAccountForm({
      username: data.account?.username || '',
      mobile: data.account?.mobile || '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
    setDeepseekForm({
      apiKey: '',
      baseUrl: data.settings?.deepseekBaseUrl || 'https://api.deepseek.com',
      model: data.settings?.deepseekModel || 'deepseek-chat',
    });
    const converter = data.settings?.converter || {};
    setConverterForm({
      mode: converter.mode || 'smart',
      structureWithAI: converter.structureWithAI !== false,
      jinaEnabled: converter.jinaEnabled !== false,
      jinaApiKey: '',
      markerApiKey: '',
      mistralApiKey: '',
    });
    setSectionForm(buildSectionForm(data.settings?.expectedSections));
  }, []);

  useEffect(() => {
    let alive = true;
    fetchSessionQuiet().then((data) => {
      if (!alive) return;
      if (!data?.authenticated) {
        router.replace('/login');
        return;
      }
      applySession(data);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [applySession, router]);

  const refresh = async () => {
    const data = await fetchSessionQuiet();
    if (data?.authenticated) applySession(data);
  };

  const run = async (label, work) => {
    setBusy(label);
    setNotice({ kind: 'info', text: '' });
    try {
      await work();
    } catch (error) {
      setNotice({ kind: 'error', text: error?.message || 'عملیات ناموفق بود.' });
    } finally {
      setBusy('');
    }
  };

  const saveAccount = () =>
    run('account', async () => {
      const result = await updateCredentials(accountForm);
      await refresh();
      setNotice({ kind: 'ok', text: `اطلاعات حساب ذخیره شد (${result.username} — ${result.mobile}).` });
    });

  const deepseekPatch = (activate = false) => {
    const patch = {
      deepseekBaseUrl: deepseekForm.baseUrl,
      deepseekModel: deepseekForm.model,
    };
    const typedKey = deepseekForm.apiKey.trim();
    if (typedKey) patch.deepseekApiKey = typedKey;
    if (activate) patch.activate = true;
    return patch;
  };

  const saveDeepseek = (activate = false) =>
    run('deepseek', async () => {
      await saveSettings(deepseekPatch(activate));
      await refresh();
      setNotice({ kind: 'ok', text: activate ? 'کلید ذخیره و فعال شد.' : 'تنظیمات دیپ‌سیک ذخیره شد.' });
    });

  const testDeepseek = () =>
    run('test', async () => {
      const result = await testDeepseekKey({
        apiKey: deepseekForm.apiKey.trim(),
        baseUrl: deepseekForm.baseUrl,
        model: deepseekForm.model,
      });
      await saveSettings(deepseekPatch(true));
      setDeepseekForm((previous) => ({ ...previous, apiKey: '' }));
      await refresh();
      const list =
        Array.isArray(result.models) && result.models.length ? result.models.join('، ') : 'نامشخص';
      setNotice({
        kind: 'ok',
        text:
          `✅ کلید تأیید و فعال شد (${result.latencyMs} میلی‌ثانیه). مدل: ${result.model} — ` +
          `مدل‌های در دسترس: ${list}${result.note ? ` — ${result.note}` : ''}`,
      });
    });

  const deactivateDeepseek = () => saveDeepseek(false);

  const saveConverters = () =>
    run('converter', async () => {
      await saveSettings({ converter: converterForm });
      setConverterForm((previous) => ({ ...previous, jinaApiKey: '', markerApiKey: '', mistralApiKey: '' }));
      await refresh();
      setNotice({ kind: 'ok', text: 'تنظیمات تبدیل‌کننده‌ها ذخیره شد.' });
    });

  const saveSections = () =>
    run('sections', async () => {
      const payload = {};
      for (const type of DOC_TYPES) {
        payload[type.id] = (sectionForm[type.id] || [])
          .map((group, index) => ({
            id: group.id || `g${index + 1}`,
            title: String(group.title || '').trim() || `گروه ${index + 1}`,
            items: parseItemsText(group.text),
          }))
          .filter((group) => group.items.length);
      }
      await saveSettings({ expectedSections: payload });
      await refresh();
      setNotice({ kind: 'ok', text: 'سرفصل‌های پیش‌فرض ذخیره شد.' });
    });

  const resetSectionType = (typeId) => {
    const groups = defaultGroupsFor(typeId);
    setSectionForm((previous) => ({
      ...previous,
      [typeId]: groups.map((group) => ({ id: group.id, title: group.title, text: itemsToText(group.items) })),
    }));
    setNotice({ kind: 'warn', text: 'فهرست این نوع سند به حالت پیش‌فرض برگشت (برای ذخیره، دکمه‌ی ذخیره را بزنید).' });
  };

  const updateGroup = (typeId, index, patch) => {
    setSectionForm((previous) => {
      const groups = [...(previous[typeId] || [])];
      groups[index] = { ...groups[index], ...patch };
      return { ...previous, [typeId]: groups };
    });
  };

  const addGroup = (typeId) => {
    setSectionForm((previous) => ({
      ...previous,
      [typeId]: [...(previous[typeId] || []), { id: `g${Date.now()}`, title: 'گروه جدید', text: '' }],
    }));
  };

  const removeGroup = (typeId, index) => {
    setSectionForm((previous) => ({
      ...previous,
      [typeId]: (previous[typeId] || []).filter((_, position) => position !== index),
    }));
  };

  const handleLogout = async () => {
    try {
      await logoutRequest();
    } catch {
      // کوکی در هر حال پاک می‌شود
    }
    router.replace('/login');
  };

  if (!ready) {
    return (
      <main className="page">
        <section className="card">
          <p className="card__hint">⏳ در حال بارگذاری پنل …</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>⚙️ پنل و تنظیمات</h1>
          <p>حساب کاربری، کلید دیپ‌سیک، تبدیل‌کننده‌ها و سرفصل‌های پیش‌فرض.</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="btn btn--ghost btn--sm" href="/">
            🏠 صفحه‌ی اصلی
          </Link>
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>
            🚪 خروج
          </button>
        </div>
      </header>

      {notice.text ? <p className={`alert alert--${notice.kind}`}>{notice.text}</p> : null}

      <section className="card">
        <div className="card__head">
          <h2>💾 وضعیت ذخیره‌سازی تنظیمات</h2>
          <span className={`badge ${status?.persistent ? 'badge--ok' : 'badge--warn'}`}>
            {STORAGE_LABELS[status?.storageMode] || 'نامشخص'}
          </span>
        </div>
        {status?.storageWarning ? <p className="alert alert--error">{status.storageWarning}</p> : null}
        {status?.persistent ? (
          <p className="card__hint">تغییرات این پنل دائمی است و بعد از دیپلوی مجدد هم می‌ماند.</p>
        ) : (
          <div className="alert alert--warn">
            روی Vercel برای ذخیره‌ی دائمی، یک دیتابیس Redis (Vercel KV یا Upstash) به پروژه وصل کنید؛ در آن
            حالت متغیرهای <b>KV_REST_API_URL</b> و <b>KV_REST_API_TOKEN</b> خودکار تنظیم می‌شوند. تا آن زمان
            تغییرات پنل فقط تا ری‌استارت بعدی باقی می‌ماند.
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__head">
          <h2>👤 حساب کاربری — نام کاربری، موبایل و رمز عبور</h2>
          <p className="card__hint">ورود به برنامه با شماره موبایل یا نام کاربری + رمز عبور انجام می‌شود.</p>
        </div>

        {account?.isDefaultPassword ? (
          <p className="alert alert--error">
            رمز عبور هنوز روی مقدار پیش‌فرض است؛ همین حالا آن را تغییر دهید.
          </p>
        ) : null}
        {account?.mobile === '09120000000' ? (
          <p className="alert alert--warn">
            شماره موبایل روی مقدار پیش‌فرض (<b className="mono">09120000000</b>) است؛ بهتر است آن را به شماره‌ی
            خودتان تغییر دهید و با آن وارد شوید.
          </p>
        ) : null}

        <div className="settings">
          <div className="field">
            <label htmlFor="username">نام کاربری</label>
            <input
              id="username"
              className="input"
              value={accountForm.username}
              onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })}
              dir="ltr"
              disabled={Boolean(busy)}
            />
          </div>
          <div className="field">
            <label htmlFor="mobile">شماره موبایل (۱۱ رقم)</label>
            <input
              id="mobile"
              className="input"
              value={accountForm.mobile}
              onChange={(event) => setAccountForm({ ...accountForm, mobile: event.target.value })}
              placeholder="09121234567"
              dir="ltr"
              disabled={Boolean(busy)}
            />
          </div>
          <div className="field">
            <label htmlFor="currentPassword">رمز عبور فعلی (برای تأیید تغییر)</label>
            <input
              id="currentPassword"
              className="input"
              type="password"
              value={accountForm.currentPassword}
              onChange={(event) => setAccountForm({ ...accountForm, currentPassword: event.target.value })}
              disabled={Boolean(busy)}
            />
          </div>
          <div className="field">
            <label htmlFor="newPassword">رمز عبور جدید (اختیاری)</label>
            <input
              id="newPassword"
              className="input"
              type="password"
              value={accountForm.newPassword}
              onChange={(event) => setAccountForm({ ...accountForm, newPassword: event.target.value })}
              placeholder="حداقل ۶ کاراکتر"
              disabled={Boolean(busy)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">تکرار رمز عبور جدید</label>
            <input
              id="confirmPassword"
              className="input"
              type="password"
              value={accountForm.confirmPassword}
              onChange={(event) => setAccountForm({ ...accountForm, confirmPassword: event.target.value })}
              disabled={Boolean(busy)}
            />
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={saveAccount} disabled={Boolean(busy)}>
            {busy === 'account' ? '⏳ در حال ذخیره …' : 'ذخیره‌ی اطلاعات حساب'}
          </button>
          {account?.updatedAt ? (
            <span className="badge">
              آخرین تغییر: {new Date(account.updatedAt).toLocaleString('fa-IR')}
            </span>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2>🔑 تنظیمات دیپ‌سیک (DeepSeek)</h2>
          <span className={`badge ${status?.ready ? 'badge--ok' : 'badge--err'}`}>
            {status?.ready ? 'فعال و آماده' : 'غیرفعال'}
          </span>
        </div>
        <p className="card__hint">
          کلید را از <b>platform.deepseek.com → API Keys</b> بگیرید. کلید فقط روی سرور ذخیره می‌شود و هرگز
          به مرورگر فرستاده نمی‌شود. اگر کلید در متغیر محیطی <b>DEEPSEEK_API_KEY</b> تنظیم شده باشد، همیشه
          به‌عنوان پشتیبان فعال است.
        </p>

        <div className="settings">
          <div className="field">
            <label htmlFor="apiKey">
              کلید API {settings?.hasStoredKey ? '(برای تغییر، کلید جدید را وارد کنید)' : ''}
            </label>
            <input
              id="apiKey"
              className="input"
              type="password"
              value={deepseekForm.apiKey}
              onChange={(event) => setDeepseekForm({ ...deepseekForm, apiKey: event.target.value })}
              placeholder={settings?.deepseekKeyPreview || 'sk-...'}
              dir="ltr"
              disabled={Boolean(busy)}
            />
          </div>
          <div className="field">
            <label htmlFor="baseUrl">آدرس سرویس</label>
            <input
              id="baseUrl"
              className="input"
              value={deepseekForm.baseUrl}
              onChange={(event) => setDeepseekForm({ ...deepseekForm, baseUrl: event.target.value })}
              dir="ltr"
              disabled={Boolean(busy)}
            />
          </div>
          <div className="field">
            <label htmlFor="modelName">مدل پیش‌فرض</label>
            <select
              id="modelName"
              className="select"
              value={deepseekForm.model}
              onChange={(event) => setDeepseekForm({ ...deepseekForm, model: event.target.value })}
              disabled={Boolean(busy)}
            >
              {MODELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={testDeepseek} disabled={Boolean(busy)}>
            {busy === 'test' ? '⏳ در حال تست …' : '🔍 تست اتصال و فعال‌سازی'}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => saveDeepseek(true)}
            disabled={Boolean(busy) || !settings?.hasStoredKey}
          >
            فعال‌سازی کلید ذخیره‌شده
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => saveDeepseek(false)}
            disabled={Boolean(busy)}
          >
            ذخیره بدون فعال‌سازی
          </button>
          {status?.ready ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={deactivateDeepseek}
              disabled={Boolean(busy)}
            >
              غیرفعال‌کردن کلید
            </button>
          ) : null}
        </div>

        {status?.ready ? (
          <p className="card__hint">
            کلید فعال: <b className="mono">{settings?.deepseekKeyPreview || '—'}</b>
            {settings?.deepseekVerifiedAt
              ? ` — آخرین تأیید: ${new Date(settings.deepseekVerifiedAt).toLocaleString('fa-IR')}`
              : ''}
          </p>
        ) : settings?.deepseekKeyPreview ? (
          <p className="card__hint">
            کلید ذخیره‌شده ولی تأییدنشده: <b className="mono">{settings.deepseekKeyPreview}</b> — دکمه‌ی «تست
            اتصال» را بزنید.
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="card__head">
          <h2>🔀 تبدیل‌کننده‌های سند (اختیاری)</h2>
          <p className="card__hint">
            این بخش فقط برای تبدیل فایل/لینک به Markdown است؛ «تست اتصال» در این مرحله فقط برای دیپ‌سیک فعال است.
          </p>
        </div>

        <div className="settings">
          <div className="field">
            <label htmlFor="convertMode">روش پیش‌فرض تبدیل</label>
            <select
              id="convertMode"
              className="select"
              value={converterForm.mode}
              onChange={(event) => setConverterForm({ ...converterForm, mode: event.target.value })}
              disabled={Boolean(busy)}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>ساختاردهی Markdown با دیپ‌سیک (پیش‌فرض صفحه‌ی اصلی)</label>
            <label className="check check--wide">
              <input
                type="checkbox"
                checked={converterForm.structureWithAI}
                onChange={(event) =>
                  setConverterForm({ ...converterForm, structureWithAI: event.target.checked })
                }
                disabled={Boolean(busy)}
              />
              <span>پیش‌فرض روشن باشد</span>
            </label>
          </div>

          <div className="field">
            <label htmlFor="jinaKey">کلید Jina Reader (اختیاری)</label>
            <input
              id="jinaKey"
              className="input"
              type="password"
              value={converterForm.jinaApiKey}
              onChange={(event) => setConverterForm({ ...converterForm, jinaApiKey: event.target.value })}
              placeholder={settings?.converter?.jinaKeyPreview || 'رایگان و بدون کلید هم کار می‌کند'}
              dir="ltr"
              disabled={Boolean(busy)}
            />
          </div>

          <div className="field">
            <label htmlFor="markerKey">کلید Datalab Marker (اختیاری)</label>
            <input
              id="markerKey"
              className="input"
              type="password"
              value={converterForm.markerApiKey}
              onChange={(event) => setConverterForm({ ...converterForm, markerApiKey: event.target.value })}
              placeholder={settings?.converter?.markerKeyPreview || 'datalab.to'}
              dir="ltr"
              disabled={Boolean(busy)}
            />
          </div>

          <div className="field">
            <label htmlFor="mistralKey">کلید Mistral OCR (اختیاری)</label>
            <input
              id="mistralKey"
              className="input"
              type="password"
              value={converterForm.mistralApiKey}
              onChange={(event) => setConverterForm({ ...converterForm, mistralApiKey: event.target.value })}
              placeholder={settings?.converter?.mistralKeyPreview || 'console.mistral.ai'}
              dir="ltr"
              disabled={Boolean(busy)}
            />
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={saveConverters} disabled={Boolean(busy)}>
            {busy === 'converter' ? '⏳ در حال ذخیره …' : 'ذخیره‌ی تنظیمات تبدیل'}
          </button>
          <span className="badge">مقدارهای ماسک‌شده یعنی «بدون تغییر»</span>
        </div>

        <p className="card__hint">
          • «Jina Reader» رایگان و بدون کلید است و لینک (صفحه‌ی وب یا PDF آنلاین) را به Markdown تبدیل می‌کند.
          <br />
          • برای تبدیل آنلاین «فایل»، کلید Marker یا Mistral را ثبت کنید (سقف ۴ مگابایت به‌دلیل محدودیت Vercel).
          <br />
          • اگر تبدیل آنلاین ممکن نباشد، تبدیل محلی در مرورگر انجام می‌شود و فایل به هیچ سروری نمی‌رود.
        </p>
      </section>

      <section className="card">
        <div className="card__head">
          <h2>🧩 سرفصل‌های پیش‌فرض (بخش‌های مورد انتظار)</h2>
          <p className="card__hint">
            این فهرست‌ها در صفحه‌ی اصلی به‌صورت جعبه‌های تیک‌دار به کاربر نشان داده می‌شوند. هر خط یک سرفصل است و
            خط‌هایی که با <b>*</b> شروع شوند، پیش‌فرض تیک‌خورده‌اند.
          </p>
        </div>

        <div className="tabs" style={{ marginTop: 0 }}>
          {DOC_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              className={`tab${sectionType === type.id ? ' tab--active' : ''}`}
              onClick={() => setSectionType(type.id)}
            >
              {type.icon} {type.label}
            </button>
          ))}
        </div>

        {(sectionForm[sectionType] || []).map((group, index) => (
          <div className="box" key={group.id || index}>
            <div className="box__head">
              <input
                className="input"
                style={{ maxWidth: 260 }}
                value={group.title}
                onChange={(event) => updateGroup(sectionType, index, { title: event.target.value })}
                disabled={Boolean(busy)}
              />
              <span className="muted">{parseItemsText(group.text).length} سرفصل</span>
              <button
                type="button"
                className="linkbtn"
                onClick={() => removeGroup(sectionType, index)}
                disabled={Boolean(busy)}
              >
                حذف گروه
              </button>
            </div>
            <textarea
              className="editor editor--short"
              value={group.text}
              onChange={(event) => updateGroup(sectionType, index, { text: event.target.value })}
              spellCheck={false}
              disabled={Boolean(busy)}
            />
          </div>
        ))}

        <div className="actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => addGroup(sectionType)}
            disabled={Boolean(busy)}
          >
            ➕ افزودن گروه
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => resetSectionType(sectionType)}
            disabled={Boolean(busy)}
          >
            ↩️ بازگردانی به پیش‌فرض این نوع
          </button>
          <button type="button" className="btn btn--primary" onClick={saveSections} disabled={Boolean(busy)}>
            {busy === 'sections' ? '⏳ در حال ذخیره …' : 'ذخیره‌ی سرفصل‌های پیش‌فرض'}
          </button>
        </div>
      </section>

    </main>
  );
}

