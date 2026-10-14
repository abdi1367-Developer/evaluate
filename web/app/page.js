'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ACCEPT_ATTRIBUTE, MAX_FILE_MB, parseDocument } from '../lib/parse';
import { extractHeadings } from '../lib/headings';
import { DEFAULT_MAX_DIRECT_CHARS, normalizeMarkdown, textStats } from '../lib/text';
import { MODELS, runAnalysis, structureToMarkdown } from '../lib/deepseek-client';
import { reportToMarkdown } from '../lib/result';
import { convertWithFile, convertWithUrl, fetchSessionQuiet, logout as logoutRequest } from '../lib/api-client';
import { defaultGroupsFor, defaultSelection, guessDocType, selectedInOrder } from '../lib/sections';
import OutlineView from '../components/OutlineView';
import ResultView from '../components/ResultView';
import ExpectedSections from '../components/ExpectedSections';

const fa = (value) => Number(value || 0).toLocaleString('fa-IR');
const megabytes = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;

const MAX_ONLINE_FILE_MB = 4;

const MAX_CHARS_OPTIONS = [
  { value: 30000, label: '۳۰٬۰۰۰ کاراکتر — کم‌هزینه' },
  { value: 60000, label: '۶۰٬۰۰۰ کاراکتر — پیشنهادی' },
  { value: 100000, label: '۱۰۰٬۰۰۰ کاراکتر — دقیق‌تر' },
];

const CONVERT_MODES = [
  { value: 'smart', label: 'هوشمند (پیشنهادی): اول آنلاین، در صورت نبود امکان محلی' },
  { value: 'local', label: 'فقط محلی: تبدیل داخل مرورگر (فایل به هیچ سروری نمی‌رود)' },
  { value: 'online', label: 'فقط آنلاین: با سرویس‌های ابری (Jina / Marker / Mistral)' },
];

const PROVIDER_LABELS = {
  local: 'تبدیل محلی در مرورگر',
  jina: 'Jina Reader (آنلاین، رایگان)',
  marker: 'Datalab Marker (آنلاین)',
  mistral: 'Mistral OCR (آنلاین)',
};

const providerLabel = (id) => PROVIDER_LABELS[id] || id || 'نامشخص';


export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [convertMode, setConvertMode] = useState('smart');
  const [structureWithAI, setStructureWithAI] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [doc, setDoc] = useState(null);
  const [markdown, setMarkdown] = useState('');
  const [headings, setHeadings] = useState([]);
  const [tab, setTab] = useState('outline');
  const [model, setModel] = useState('deepseek-chat');
  const [maxDirectChars, setMaxDirectChars] = useState(DEFAULT_MAX_DIRECT_CHARS);
  const [extraNote, setExtraNote] = useState('');
  const [logs, setLogs] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [copyLabel, setCopyLabel] = useState('کپی پاسخ خام مدل');
  const [docType, setDocType] = useState('article');
  const [sectionsSelection, setSectionsSelection] = useState([]);
  const [conversion, setConversion] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetchSessionQuiet().then((data) => {
      if (!alive) return;
      if (!data?.authenticated) {
        router.replace('/login');
        return;
      }
      setSession(data);
      const statusModel = data?.status?.model;
      if (statusModel && MODELS.some((item) => item.id === statusModel)) setModel(statusModel);
      const converter = data?.settings?.converter;
      if (converter?.mode) setConvertMode(converter.mode);
      if (converter) setStructureWithAI(converter.structureWithAI !== false);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  const groups = useMemo(() => {
    const map = session?.settings?.expectedSections;
    return (map && map[docType]) || defaultGroupsFor(docType);
  }, [session, docType]);

  const status = session?.status || null;
  const deepseekReady = Boolean(status?.ready);
  const storageIsTemp = Boolean(status && status.persistent === false);

  const stats = useMemo(() => textStats(markdown, headings), [markdown, headings]);
  const title = doc?.meta?.name || file?.name || sourceUrl || '';
  const willSummarize = stats.chars > maxDirectChars;
  const estimatedCalls = willSummarize
    ? Math.min(10, Math.ceil(stats.chars / Math.max(1000, maxDirectChars * 0.6))) + 1
    : 1;

  const selectedSections = useMemo(
    () => selectedInOrder(groups, sectionsSelection),
    [groups, sectionsSelection]
  );

  const applyDocType = (nextType) => {
    const map = session?.settings?.expectedSections;
    const nextGroups = (map && map[nextType]) || defaultGroupsFor(nextType);
    setDocType(nextType);
    setSectionsSelection(defaultSelection(nextGroups));
  };

  const toggleSection = (title) => {
    setSectionsSelection((previous) =>
      previous.includes(title) ? previous.filter((item) => item !== title) : [...previous, title]
    );
  };

  const handleLogout = async () => {
    try {
      await logoutRequest();
    } catch {
      // کوکی در هر صورت پاک می‌شود
    }
    router.replace('/login');
  };

  const resetDoc = () => {
    setDoc(null);
    setMarkdown('');
    setHeadings([]);
    setAnalysis(null);
    setLogs([]);
    setError('');
    setNotice('');
  };

  const pickFile = (fileList) => {
    const picked = fileList && fileList[0];
    if (!picked) return;
    if (picked.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`حجم فایل (${megabytes(picked.size)}) بیشتر از حد مجاز (${MAX_FILE_MB} مگابایت) است.`);
      return;
    }
    setFile(picked);
    resetDoc();
  };

  const handleConvert = async () => {
    const url = sourceUrl.trim();
    if (!file && !url) {
      setError('یک فایل PDF/Word انتخاب کنید یا لینک مقاله/کتاب را وارد کنید.');
      return;
    }

    setConverting(true);
    setError('');
    setNotice('شروع تبدیل …');
    setAnalysis(null);
    setConversion(null);
    setLogs([]);

    const converterSettings = session?.settings?.converter || {};
    const hasCloudKey = Boolean(converterSettings.hasMarkerKey || converterSettings.hasMistralKey);
    const onlineAllowed = convertMode !== 'local';
    const notes = [];

    try {
      let markdown = '';
      let provider = 'local';
      let parsedLocal = null;

      // ۱) تبدیل آنلاین از روی لینک (Jina Reader — رایگان و بدون کلید)
      if (onlineAllowed && url) {
        try {
          setNotice('تبدیل آنلاین لینک با Jina Reader …');
          const remote = await convertWithUrl({ url, provider: 'jina' });
          markdown = remote.markdown;
          provider = remote.provider || 'jina';
          if (remote.notes?.length) notes.push(...remote.notes);
        } catch (remoteError) {
          notes.push(`تبدیل آنلاین لینک: ${remoteError.message}`);
        }
      }

      // ۲) فایل: اگر کلید سرویس ابری ثبت شده باشد اول آنلاین، در غیر این صورت محلی
      if (!markdown && file) {
        const canUpload = onlineAllowed && hasCloudKey && file.size <= MAX_ONLINE_FILE_MB * 1024 * 1024;
        if (canUpload) {
          try {
            setNotice('ارسال فایل به سرویس تبدیل آنلاین …');
            const form = new FormData();
            form.append('file', file);
            const remote = await convertWithFile(form);
            markdown = remote.markdown;
            provider = remote.provider || 'online';
            if (remote.notes?.length) notes.push(...remote.notes);
          } catch (remoteError) {
            notes.push(`تبدیل آنلاین فایل: ${remoteError.message}`);
          }
        }

        if (!markdown) {
          setNotice(`تبدیل محلی «${file.name}» در مرورگر …`);
          parsedLocal = await parseDocument(file, { onProgress: (message) => setNotice(message) });
          markdown = parsedLocal.markdown;
          provider = 'local';
          if (parsedLocal.notes?.length) notes.push(...parsedLocal.notes);
        }
      }

      if (!markdown.trim()) {
        throw new Error('متنی از منبع انتخاب‌شده به دست نیامد.');
      }

      // ۳) ساختاردهی Markdown با دیپ‌سیک (اختیاری)
      if (structureWithAI && deepseekReady && markdown.length > 300) {
        try {
          const structured = await structureToMarkdown({
            text: markdown,
            title: file?.name || url || '',
            model,
            onProgress: (message) => setNotice(message),
          });
          if (structured?.markdown) markdown = structured.markdown;
        } catch (structureError) {
          notes.push(`ساختاردهی با دیپ‌سیک: ${structureError.message}`);
        }
      }

      const finalMarkdown = normalizeMarkdown(markdown);
      const finalHeadings = extractHeadings(finalMarkdown);
      const finalStats = textStats(finalMarkdown, finalHeadings);

      setDoc({
        markdown: finalMarkdown,
        headings: finalHeadings,
        stats: finalStats,
        notes,
        pageCount: parsedLocal?.pageCount || null,
        meta: parsedLocal?.meta || {
          name: file?.name || url || 'منبع آنلاین',
          size: file?.size || 0,
          extension: file ? String(file.name).split('.').pop().toLowerCase() : 'url',
        },
      });
      setMarkdown(finalMarkdown);
      setHeadings(finalHeadings);
      setConversion({ provider, notes });
      applyDocType(guessDocType(finalMarkdown, file?.name || url));
      setTab('outline');
      setNotice(
        `تبدیل انجام شد (${providerLabel(provider)}): ${fa(finalStats.chars)} کاراکتر و ` +
          `${fa(finalHeadings.length)} سرفصل شناسایی شد.`
      );
    } catch (conversionError) {
      setError(conversionError?.message || 'تبدیل فایل ناموفق بود.');
      setNotice('');
    } finally {
      setConverting(false);
    }
  };

  const refreshHeadings = () => {
    const list = extractHeadings(markdown);
    setHeadings(list);
    setNotice(`سرفصل‌ها دوباره استخراج شد: ${fa(list.length)} مورد.`);
  };

  const handleAnalyze = async () => {
    if (!markdown.trim()) {
      setError('متنی برای تحلیل وجود ندارد؛ اول فایل را تبدیل کنید.');
      return;
    }
    if (!deepseekReady) {
      setError('کلید دیپ‌سیک فعال نیست؛ در «پنل ← تنظیمات دیپ‌سیک» کلید را ثبت کنید و دکمه‌ی تست را بزنید.');
      return;
    }
    setAnalyzing(true);
    setError('');
    setNotice('');
    setAnalysis(null);
    setCopyLabel('کپی پاسخ خام مدل');
    setLogs([
      `شروع تحلیل با مدل «${model}» …`,
      selectedSections.length
        ? `${selectedSections.length} سرفصل مورد انتظار برای بررسی انتخاب شده است.`
        : 'هیچ سرفصل مورد انتظاری انتخاب نشده است.',
    ]);
    setTab('result');

    try {
      const outcome = await runAnalysis({
        markdown,
        headings,
        title,
        model,
        maxDirectChars,
        extraNote,
        expectedSections: selectedSections,
        onProgress: (message) => setLogs((previous) => [...previous, message]),
      });
      setAnalysis(outcome);
      setLogs((previous) => [
        ...previous,
        `تمام شد. نمره‌ی نهایی: ${outcome.result.score ?? '—'} از ۱۰۰ (${outcome.result.grade})`,
      ]);
    } catch (analysisError) {
      setError(analysisError?.message || 'تحلیل با دیپ‌سیک ناموفق بود.');
      setLogs((previous) => [...previous, `خطا: ${analysisError?.message || 'نامشخص'}`]);
      setTab('outline');
    } finally {
      setAnalyzing(false);
    }
  };

  const downloadReport = () => {
    if (!analysis) return;
    const meta = {
      فایل: title || 'نامشخص',
      مدل: analysis.model,
      حالت: analysis.modeLabel,
      تاریخ: new Date().toLocaleString('fa-IR'),
    };
    const content = `\uFEFF${reportToMarkdown(analysis.result, meta)}\n\n---\n\n## متن Markdown سند\n\n${markdown}\n`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `report-${(title || 'document').replace(/\.[^.]+$/, '')}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const copyRawJson = async () => {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis.raw);
      setCopyLabel('✅ کپی شد');
    } catch {
      setCopyLabel('کپی نشد — دستی انتخاب کنید');
    }
  };

  const busy = converting || analyzing;

  if (!ready) {
    return (
      <main className="page">
        <section className="card">
          <p className="card__hint">⏳ در حال بررسی نشست کاربری …</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>📚 سرفصل‌یاب و داور هوشمند</h1>
          <p>
            PDF/Word ← Markdown ← فهرست سرفصل‌ها ← تحلیل و نمره‌دهی با DeepSeek.
            <br />
            تبدیل فایل داخل مرورگر انجام می‌شود (یا با سرویس‌های آنلاین) و فقط متن استخراج‌شده به مدل می‌رود.
          </p>
        </div>
        <div className="header__side">
          <div className="badges">
            {deepseekReady ? (
              <span className="badge badge--ok">🔑 کلید دیپ‌سیک فعال</span>
            ) : (
              <span className="badge badge--err">⛔ کلید دیپ‌سیک فعال نیست</span>
            )}
            {status?.source ? (
              <span className="badge">
                {status.source === 'env'
                  ? 'کلید از متغیر محیطی'
                  : status.source === 'panel'
                    ? 'کلید ثبت‌شده در پنل'
                    : 'کلید تأییدنشده'}
              </span>
            ) : null}
            {storageIsTemp ? (
              <span className="badge badge--warn">⚠️ ذخیره‌سازی موقت</span>
            ) : null}
            {session?.account ? (
              <span className="badge">
                👤 {session.account.username} — {session.account.mobileMasked}
              </span>
            ) : null}
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <Link className="btn btn--ghost btn--sm" href="/panel">
              ⚙️ پنل و تنظیمات
            </Link>
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>
              🚪 خروج
            </button>
          </div>
        </div>
      </header>

      <section className="card">
        <div className="card__head">
          <h2>۱) منبع مقاله / کتاب</h2>
          <p className="card__hint">
            فایل PDF/DOCX/MD/TXT (تا {MAX_FILE_MB} مگابایت) یا لینک مقاله‌ی آنلاین — تبدیل در مرورگر یا با
            سرویس‌های ابری انجام می‌شود.
          </p>
        </div>

        <div
          className={`dropzone${dragging ? ' dropzone--active' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pickFile(event.dataTransfer?.files);
          }}
        >
          <strong>فایل را اینجا بکشید و رها کنید</strong>
          <span>یا کلیک کنید و از رایانه انتخاب کنید</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            pickFile(event.target.files);
            event.target.value = '';
          }}
        />

        {file ? (
          <div className="fileinfo">
            <span>📄 {file.name}</span>
            <span>{megabytes(file.size)}</span>
          </div>
        ) : null}

        <div className="settings" style={{ marginTop: 16 }}>
          <div className="field">
            <label htmlFor="sourceUrl">لینک مقاله/کتاب آنلاین (اختیاری)</label>
            <input
              id="sourceUrl"
              className="input"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com/paper.pdf"
              disabled={busy}
              dir="ltr"
            />
          </div>
          <div className="field">
            <label htmlFor="convertMode">روش تبدیل</label>
            <select
              id="convertMode"
              className="select"
              value={convertMode}
              onChange={(event) => setConvertMode(event.target.value)}
              disabled={busy}
            >
              {CONVERT_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>ساختاردهی Markdown با دیپ‌سیک</label>
            <label className="check check--wide">
              <input
                type="checkbox"
                checked={structureWithAI}
                onChange={(event) => setStructureWithAI(event.target.checked)}
                disabled={busy || !deepseekReady}
              />
              <span>سرفصل‌ها و جدول‌ها مرتب شوند (توکن بیشتری مصرف می‌کند)</span>
            </label>
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleConvert}
            disabled={busy || (!file && !sourceUrl.trim())}
          >
            {converting ? '⏳ در حال تبدیل و استخراج سرفصل …' : '۱) تبدیل به Markdown و استخراج سرفصل'}
          </button>
          {file || sourceUrl ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => {
                setFile(null);
                setSourceUrl('');
                resetDoc();
              }}
            >
              پاک کردن منبع
            </button>
          ) : null}
        </div>

        {notice && !error ? <p className="alert alert--info">{notice}</p> : null}
        {error ? <p className="alert alert--error">{error}</p> : null}
        {doc?.notes?.length ? (
          <div className="alert alert--warn">
            {doc.notes.map((note, index) => (
              <div key={index}>• {note}</div>
            ))}
          </div>
        ) : null}
      </section>

      {doc || markdown ? (
        <ExpectedSections
          docType={docType}
          groups={groups}
          selection={sectionsSelection}
          disabled={busy}
          onDocTypeChange={applyDocType}
          onToggle={toggleSection}
          onSetSelection={setSectionsSelection}
        />
      ) : null}

      {doc || markdown ? (
        <section className="card">
          <div className="card__head">
            <h2>۳) نتیجه‌ی تبدیل</h2>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={refreshHeadings}
                disabled={busy}
              >
                ♻️ به‌روزرسانی سرفصل‌ها از متن ویرایش‌شده
              </button>
            </div>
          </div>

          <div className="statbar">
            <div className="stat">
              <b>{fa(stats.chars)}</b>
              <span>کاراکتر</span>
            </div>
            <div className="stat">
              <b>{fa(stats.words)}</b>
              <span>واژه</span>
            </div>
            <div className="stat">
              <b>{fa(stats.headings)}</b>
              <span>سرفصل</span>
            </div>
            <div className="stat">
              <b>≈ {fa(stats.tokens)}</b>
              <span>توکن تخمینی</span>
            </div>
            {doc?.pageCount ? (
              <div className="stat">
                <b>{fa(doc.pageCount)}</b>
                <span>صفحه‌ی PDF</span>
              </div>
            ) : null}
          </div>

          <div className="tabs" style={{ marginTop: 18 }}>
            <button
              type="button"
              className={`tab${tab === 'outline' ? ' tab--active' : ''}`}
              onClick={() => setTab('outline')}
            >
              🔢 سرفصل‌ها
            </button>
            <button
              type="button"
              className={`tab${tab === 'markdown' ? ' tab--active' : ''}`}
              onClick={() => setTab('markdown')}
            >
              📄 متن Markdown
            </button>
            <button
              type="button"
              className={`tab${tab === 'result' ? ' tab--active' : ''}`}
              onClick={() => setTab('result')}
              disabled={!analysis && !analyzing}
            >
              ⭐ تحلیل و نمره
            </button>
          </div>

          {tab === 'outline' ? <OutlineView headings={headings} /> : null}

          {tab === 'markdown' ? (
            <>
              <p className="card__hint">
                می‌توانید متن را همین‌جا ویرایش کنید؛ دقیقاً همین متن به دیپ‌سیک فرستاده می‌شود. بعد از
                ویرایش، دکمه‌ی «به‌روزرسانی سرفصل‌ها» را بزنید.
              </p>
              <textarea
                className="editor"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                spellCheck={false}
              />
            </>
          ) : null}

          {tab === 'result' ? (
            analysis ? (
              <ResultView
                analysis={analysis}
                onDownload={downloadReport}
                onCopyJson={copyRawJson}
                copyLabel={copyLabel}
              />
            ) : (
              <p className="alert alert--info" style={{ marginTop: 0 }}>
                {analyzing
                  ? 'داوری در جریان است؛ نتیجه به‌زودی این‌جا نمایش داده می‌شود …'
                  : 'هنوز تحلیلی انجام نشده است.'}
              </p>
            )
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <div className="card__head">
          <h2>۴) تحلیل با DeepSeek</h2>
          <p className="card__hint">
            {deepseekReady
              ? willSummarize
                ? `متن بلند است (${fa(stats.chars)} کاراکتر) → حدود ${fa(estimatedCalls)} درخواست به دیپ‌سیک`
                : 'متن کوتاه است و یک‌جا داوری می‌شود'
              : 'کلید دیپ‌سیک فعال نیست؛ برای شروع، در پنل کلید را ثبت و تست کنید.'}
          </p>
        </div>

        <div className="settings">
          <div className="field">
            <label htmlFor="model">مدل</label>
            <select
              id="model"
              className="select"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={busy}
            >
              {MODELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="maxchars">سقف متن برای ارسال یک‌جا</label>
            <select
              id="maxchars"
              className="select"
              value={maxDirectChars}
              onChange={(event) => setMaxDirectChars(Number(event.target.value))}
              disabled={busy}
            >
              {MAX_CHARS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="note">تأکید/نکته‌ی خاص برای داور (اختیاری)</label>
            <input
              id="note"
              className="input"
              value={extraNote}
              onChange={(event) => setExtraNote(event.target.value)}
              placeholder="مثال: تمرکز روی بخش روش‌شناسی"
              disabled={busy}
            />
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleAnalyze}
            disabled={busy || !markdown.trim()}
          >
            {analyzing ? '⏳ در حال تحلیل و نمره‌دهی …' : 'تحلیل با DeepSeek و گرفتن نمره'}
          </button>
          {analysis ? (
            <span className="badge badge--ok">
              نمره: {analysis.result.score ?? '—'} از ۱۰۰ — {analysis.result.grade}
            </span>
          ) : null}
        </div>

        {!deepseekReady ? (
          <div className="alert alert--warn">
            برای تحلیل، کلید دیپ‌سیک باید فعال باشد. به <Link href="/panel">پنل و تنظیمات</Link> بروید و در بخش
            «تنظیمات دیپ‌سیک» کلید را وارد کنید، دکمه‌ی «تست اتصال» را بزنید و سپس آن را فعال کنید. (اگر روی
            Vercel متغیر <b>DEEPSEEK_API_KEY</b> را تنظیم کرده باشید، به‌صورت خودکار فعال است.)
          </div>
        ) : null}

        {logs.length ? (
          <ul className="log">
            {logs.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <footer className="footer">
        ساخته‌شده با Next.js برای دیپلوی روی Vercel — تبدیل PDF/Word در مرورگر و داوری با DeepSeek.
      </footer>
    </main>
  );
}

