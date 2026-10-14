'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCEPT_ATTRIBUTE, MAX_FILE_MB, parseDocument } from '../lib/parse';
import { extractHeadings } from '../lib/headings';
import { DEFAULT_MAX_DIRECT_CHARS, textStats } from '../lib/text';
import { MODELS, checkServer, runAnalysis } from '../lib/deepseek-client';
import { reportToMarkdown } from '../lib/result';
import OutlineView from '../components/OutlineView';
import ResultView from '../components/ResultView';

const fa = (value) => Number(value || 0).toLocaleString('fa-IR');
const megabytes = (bytes) => `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;

const MAX_CHARS_OPTIONS = [
  { value: 30000, label: '۳۰٬۰۰۰ کاراکتر — کم‌هزینه' },
  { value: 60000, label: '۶۰٬۰۰۰ کاراکتر — پیشنهادی' },
  { value: 100000, label: '۱۰۰٬۰۰۰ کاراکتر — دقیق‌تر' },
];

export default function Home() {
  const [server, setServer] = useState(null);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState(null);
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
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    checkServer().then((info) => {
      if (!alive) return;
      setServer(info);
      if (info?.defaultModel) setModel(info.defaultModel);
    });
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => textStats(markdown, headings), [markdown, headings]);
  const title = doc?.meta?.name || file?.name || '';
  const willSummarize = stats.chars > maxDirectChars;
  const estimatedCalls = willSummarize
    ? Math.min(10, Math.ceil(stats.chars / Math.max(1000, maxDirectChars * 0.6))) + 1
    : 1;

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
    if (!file) {
      setError('اول یک فایل PDF یا Word انتخاب کنید.');
      return;
    }
    setConverting(true);
    setError('');
    setNotice('در حال تبدیل فایل …');
    setAnalysis(null);
    setLogs([]);
    try {
      const parsed = await parseDocument(file, {
        onProgress: (message) => setNotice(message),
      });
      setDoc(parsed);
      setMarkdown(parsed.markdown);
      setHeadings(parsed.headings);
      setTab('outline');
      setNotice(
        `تبدیل انجام شد: ${fa(parsed.stats.chars)} کاراکتر، ${fa(parsed.stats.words)} واژه و ` +
          `${fa(parsed.headings.length)} سرفصل شناسایی شد.`
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
    setAnalyzing(true);
    setError('');
    setNotice('');
    setAnalysis(null);
    setCopyLabel('کپی پاسخ خام مدل');
    setLogs([`شروع تحلیل با مدل «${model}» …`]);
    setTab('result');

    try {
      const outcome = await runAnalysis({
        markdown,
        headings,
        title,
        model,
        maxDirectChars,
        extraNote,
        password,
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

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>📚 سرفصل‌یاب و داور هوشمند</h1>
          <p>
            PDF/Word ← Markdown ← فهرست سرفصل‌ها ← تحلیل و نمره‌دهی با DeepSeek.
            <br />
            فایل شما به هیچ سروری آپلود نمی‌شود؛ تبدیل داخل مرورگر انجام می‌شود و فقط متن استخراج‌شده به مدل می‌رود.
          </p>
        </div>
        <div className="badges">
          <span className="badge badge--ok">⚡ آماده‌ی دیپلوی روی Vercel</span>
          {server === null ? <span className="badge">⏳ بررسی سرور …</span> : null}
          {server && server.ready ? <span className="badge badge--ok">🔑 کلید API تنظیم شده</span> : null}
          {server && server.ready === false ? (
            <span className="badge badge--err">⛔ کلید API تنظیم نشده</span>
          ) : null}
          {server && server.needsPassword ? (
            <span className="badge badge--ok">🔒 رمز دسترسی فعال</span>
          ) : null}
          {server && server.ready && !server.needsPassword ? (
            <span className="badge badge--warn">🔓 بدون رمز دسترسی</span>
          ) : null}
        </div>
      </header>

      <section className="card">
        <div className="card__head">
          <h2>۱) فایل مقاله / کتاب</h2>
          <p className="card__hint">
            فرمت‌های مجاز: PDF ، DOCX ، MD ، TXT — حداکثر {MAX_FILE_MB} مگابایت
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

        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleConvert}
            disabled={busy || !file}
          >
            {converting ? '⏳ در حال تبدیل و استخراج سرفصل …' : '۱) تبدیل به Markdown و استخراج سرفصل'}
          </button>
          {file ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => {
                setFile(null);
                resetDoc();
              }}
            >
              پاک کردن فایل
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
        <section className="card">
          <div className="card__head">
            <h2>۲) نتیجه‌ی تبدیل</h2>
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
          <h2>۳) تحلیل با DeepSeek</h2>
          <p className="card__hint">
            {willSummarize
              ? `متن بلند است (${fa(stats.chars)} کاراکتر) → حدود ${fa(estimatedCalls)} درخواست به دیپ‌سیک`
              : 'متن کوتاه است و یک‌جا داوری می‌شود'}
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
            <label htmlFor="password">
              رمز دسترسی {server?.needsPassword ? '(لازم است)' : '(اختیاری)'}
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                server?.needsPassword ? 'رمز تعیین‌شده روی سرور' : 'اگر سرور رمز ندارد، خالی بگذارید'
              }
              disabled={busy}
            />
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
            {analyzing ? '⏳ در حال تحلیل و نمره‌دهی …' : '۲) تحلیل با DeepSeek و گرفتن نمره'}
          </button>
          {analysis ? (
            <span className="badge badge--ok">
              نمره: {analysis.result.score ?? '—'} از ۱۰۰ — {analysis.result.grade}
            </span>
          ) : null}
        </div>

        {server && server.ready === false ? (
          <div className="alert alert--error">
            کلید API روی سرور تنظیم نشده است.{server.error ? ` (${server.error})` : ''} روی Vercel در
            Settings ← Environment Variables متغیر <b>DEEPSEEK_API_KEY</b> را وارد کنید و پروژه را
            دوباره دیپلوی کنید (و برای اجرای محلی در فایل <b>.env.local</b> بگذارید).
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

