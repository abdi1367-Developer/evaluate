'use client';

import { SECTION_STATUS, scoreTone, sectionSummary } from '../lib/result';

const fa = (value) => Number(value || 0).toLocaleString('fa-IR');

function ScoreCircle({ score }) {
  const tone = scoreTone(score);
  return (
    <div className={`score score--${tone}`}>
      <div>
        <b>{score === null || score === undefined ? '—' : fa(score)}</b>
        <span>از ۱۰۰</span>
      </div>
    </div>
  );
}

function CriterionRow({ item }) {
  const value = item.score;
  return (
    <tr>
      <td className="criterion__name">{item.name}</td>
      <td style={{ width: 130 }}>
        {value === null || value === undefined ? (
          <span className="muted">—</span>
        ) : (
          <>
            <b>{fa(value)}</b>
            <div className="bar">
              <div
                className="bar__fill"
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
              />
            </div>
          </>
        )}
      </td>
      <td>{item.comment || <span className="muted">—</span>}</td>
    </tr>
  );
}

/** نمایش کارت نتیجه‌ی داوری */
export default function ResultView({ analysis, onDownload, onCopyJson, copyLabel }) {
  if (!analysis?.result) return null;
  const { result, model, modeLabel, originalChars, judgeChars, chunkCount } = analysis;
  const sectionCounts = sectionSummary(result.sections);

  return (
    <div>
      <div className="result__top">
        <ScoreCircle score={result.score} />
        <div className="result__meta">
          <h3>{result.grade || 'نامشخص'}</h3>
          <p>
            مدل: <b>{model}</b> — نحوه‌ی ارسال: {modeLabel}
          </p>
          <p>
            حجم متن اصلی: {fa(originalChars)} کاراکتر
            {judgeChars && judgeChars !== originalChars
              ? ` — حجم متن داوری‌شده: ${fa(judgeChars)} کاراکتر`
              : ''}
            {chunkCount ? ` — تعداد بخش‌های خلاصه‌شده: ${fa(chunkCount)}` : ''}
          </p>
        </div>
        <div className="spacer" />
        <div className="actions" style={{ marginTop: 0 }}>
          {onDownload ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={onDownload}>
              ⬇ دانلود گزارش (Markdown)
            </button>
          ) : null}
          {onCopyJson ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onCopyJson}>
              {copyLabel || 'کپی پاسخ خام مدل'}
            </button>
          ) : null}
        </div>
      </div>

      {result.summary ? (
        <div className="box" style={{ marginBottom: 16 }}>
          <h4>📝 چکیده</h4>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{result.summary}</p>
        </div>
      ) : null}

      {result.sections?.length ? (
        <div className="box" style={{ marginBottom: 16 }}>
          <h4>
            🧩 بخش‌های مورد انتظار
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {' '}
              — موجود: {fa(sectionCounts.ok)} / ناقص: {fa(sectionCounts.partial)} / غایب: {fa(sectionCounts.missing)}
            </span>
          </h4>
          <div className="checks checks--result">
            {result.sections.map((item, index) => {
              const tone = SECTION_STATUS[item.status] || SECTION_STATUS.partial;
              return (
                <div key={`${item.title}-${index}`} className={`sect sect--${item.status}`}>
                  <div className="sect__head">
                    <b>
                      {tone.mark} {item.title}
                    </b>
                    <span className={`badge badge--${item.status === 'ok' ? 'ok' : item.status === 'missing' ? 'err' : 'warn'}`}>
                      {tone.label}
                    </span>
                  </div>
                  {item.note ? <p className="muted">{item.note}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {result.criteria.length ? (
        <>
          <h4 style={{ margin: '0 0 4px' }}>📊 نمره‌ی معیارها</h4>
          <table className="table">
            <thead>
              <tr>
                <th>معیار</th>
                <th>نمره (از ۱۰۰)</th>
                <th>توضیح داور</th>
              </tr>
            </thead>
            <tbody>
              {result.criteria.map((item, index) => (
                <CriterionRow key={`${item.name}-${index}`} item={item} />
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <div className="two-cols">
        {result.strengths.length ? (
          <div className="box box--good">
            <h4>✅ نقاط قوت</h4>
            <ul>
              {result.strengths.map((item, index) => (
                <li key={`s-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.weaknesses.length ? (
          <div className="box box--warn">
            <h4>⚠️ نقاط ضعف</h4>
            <ul>
              {result.weaknesses.map((item, index) => (
                <li key={`w-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {result.suggestions.length ? (
        <div className="box" style={{ marginTop: 16 }}>
          <h4>🛠 پیشنهادهای بهبود</h4>
          <ol>
            {result.suggestions.map((item, index) => (
              <li key={`p-${index}`}>{item}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.verdict ? (
        <div className="verdict">
          <h4>🎯 جمع‌بندی داور</h4>
          <p>{result.verdict}</p>
        </div>
      ) : null}

      <details className="raw">
        <summary>مشاهده‌ی پاسخ خام مدل (JSON)</summary>
        <pre>{analysis.raw}</pre>
      </details>
    </div>
  );
}
