/**
 * تفسیر و نرمال‌سازی پاسخ مدل (معادل parse_json_response و normalize_result در analyzer.py).
 */

const PERSIAN_DIGITS = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const DIGIT_RE = /[۰-۹٠-٩]/g;

function toAsciiDigits(text) {
  return String(text).replace(DIGIT_RE, (digit) => PERSIAN_DIGITS[digit] || digit);
}

/** ارقام فارسی «بیرون از رشته‌های JSON» را به انگلیسی تبدیل می‌کند تا json معتبر شود */
function fixNumericDigits(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    output += PERSIAN_DIGITS[char] || char;
  }
  return output;
}

function ensureObject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('ساختار پاسخ دیپ‌سیک با انتظار ما هم‌خوانی ندارد.');
  }
  return data;
}

function parseJson(text) {
  const fixed = fixNumericDigits(text);
  try {
    return ensureObject(JSON.parse(fixed));
  } catch {
    const start = fixed.indexOf('{');
    const end = fixed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('پاسخ دیپ‌سیک JSON معتبر نبود.');
    }
    try {
      return ensureObject(JSON.parse(fixed.slice(start, end + 1)));
    } catch (error) {
      throw new Error(`پاسخ دیپ‌سیک JSON معتبر نبود: ${error?.message || error}`);
    }
  }
}

/** پاسخ مدل را به شیء تبدیل می‌کند (با تحمل ```json و متن اضافه) */
export function parseJsonResponse(text) {
  let cleaned = String(text || '').trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) cleaned = fenced[1].trim();
  return parseJson(cleaned);
}

/** هر ورودی (عدد، رشته، رقم فارسی) را به عدد صحیح تبدیل می‌کند */
export function asInt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const match = toAsciiDigits(value).match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(',', '.'));
  return Number.isFinite(number) ? Math.round(number) : null;
}

function stringifyItem(item) {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    return Object.entries(item)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' — ')
      .trim();
  }
  return String(item).trim();
}

/** ورودی را به فهرست رشته‌ها تبدیل می‌کند */
export function asList(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    return value
      .split(/[\n؛;]+/)
      .map((item) => item.replace(/^[\s\-–•*]+/, '').replace(/\s+$/, ''))
      .filter((item) => item.length > 1);
  }
  if (Array.isArray(value)) return value.map(stringifyItem).filter(Boolean);
  return [stringifyItem(value)].filter(Boolean);
}

/** تبدیل نمره به توصیف کیفی */
export function gradeFromScore(score) {
  if (score === null || score === undefined) return 'نامشخص';
  if (score >= 90) return 'عالی';
  if (score >= 80) return 'خیلی خوب';
  if (score >= 70) return 'خوب';
  if (score >= 55) return 'قابل قبول';
  return 'ضعیف';
}

/** رنگ/حالت نمایش بر اساس نمره */
export function scoreTone(score) {
  if (score === null || score === undefined) return 'none';
  if (score >= 80) return 'good';
  if (score >= 60) return 'mid';
  return 'low';
}

function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(stringifyItem).filter(Boolean).join('\n');
  if (typeof value === 'object') return stringifyItem(value);
  return String(value).trim();
}

/** خروجی مدل را به ساختاری یکدست تبدیل می‌کند تا نمایش آن خطا ندهد */
export function normalizeResult(data) {
  const rawCriteria = Array.isArray(data?.criteria) ? data.criteria : [];
  const criteria = rawCriteria
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return {
          name: String(item.name || '').trim() || 'معیار',
          score: asInt(item.score),
          comment: asText(item.comment),
        };
      }
      const text = asText(item);
      return text ? { name: text, score: null, comment: '' } : null;
    })
    .filter(Boolean);

  // اگر مدل نمره‌ی معیارها را از ۱۰ داده باشد، به مقیاس ۱۰۰ تبدیل می‌شود
  const numeric = criteria.map((item) => item.score).filter((value) => value !== null);
  if (numeric.length && numeric.every((value) => value <= 10)) {
    criteria.forEach((item) => {
      if (item.score !== null) item.score = Math.min(100, item.score * 10);
    });
  }

  const score = asInt(data?.score);
  return {
    score,
    grade: asText(data?.grade) || gradeFromScore(score),
    criteria,
    sections: normalizeSections(data?.sections),
    summary: asText(data?.summary),
    strengths: asList(data?.strengths),
    weaknesses: asList(data?.weaknesses),
    suggestions: asList(data?.suggestions),
    verdict: asText(data?.verdict),
  };
}

export const SECTION_STATUS = {
  ok: { label: 'موجود', mark: '✅' },
  partial: { label: 'ناقص', mark: '⚠️' },
  missing: { label: 'غایب', mark: '❌' },
};

/** آرایه‌ی «بخش‌های مورد انتظار» مدل را به شکل یکدست تبدیل می‌کند */
export function normalizeSections(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      if (typeof item === 'string') {
        const title = item.trim();
        return title ? { title, status: 'partial', present: false, note: '' } : null;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const title = asText(item.title) || asText(item.name);
      if (!title) return null;

      const rawStatus = asText(item.status);
      const presence = item.present;
      let status = 'partial';
      if (/غایب|غايب|ندارد|نبود|موجود نیست|missing|absent/i.test(rawStatus)) status = 'missing';
      else if (/ناقص|ضعیف|ضعيف|جزئی|جزئي|partial|incomplete/i.test(rawStatus)) status = 'partial';
      else if (/موجود|دارد|هست|بله|ok|complete|present|yes/i.test(rawStatus)) status = 'ok';
      else if (presence === true || presence === 1) status = 'ok';
      else if (presence === false || presence === 0) status = 'missing';
      else if (typeof presence === 'string') {
        status = /^(true|yes|بله|1)$/i.test(presence.trim()) ? 'ok' : 'missing';
      }

      return {
        title,
        status,
        present: status === 'ok',
        note: asText(item.note) || asText(item.comment) || asText(item.description),
      };
    })
    .filter(Boolean);
}

/** شمارش وضعیت بخش‌های مورد انتظار */
export function sectionSummary(sections) {
  const list = Array.isArray(sections) ? sections : [];
  return {
    total: list.length,
    ok: list.filter((item) => item.status === 'ok').length,
    partial: list.filter((item) => item.status === 'partial').length,
    missing: list.filter((item) => item.status === 'missing').length,
  };
}

const SCORE_MARK = { good: '🟢', mid: '🟡', low: '🔴', none: '⚪' };

/** نتیجه‌ی داوری را به Markdown خوانا تبدیل می‌کند (برای کپی یا دانلود گزارش) */
export function reportToMarkdown(result, meta = {}) {
  const score = result?.score ?? null;
  const lines = [];

  lines.push(`# ${SCORE_MARK[scoreTone(score)]} نمره‌ی نهایی: ${score ?? '—'} از ۱۰۰`);
  lines.push(`**ارزیابی کلی:** ${result?.grade || 'نامشخص'}`);
  if (score !== null && score !== undefined) {
    const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
    lines.push(`\`${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}\``);
  }
  const metaLines = Object.values(meta || {}).filter(
    (value) => value !== null && value !== undefined && String(value).trim()
  );
  if (metaLines.length) lines.push(`_${metaLines.join('  |  ')}_`);
  lines.push('');

  if (result?.summary) {
    lines.push('## 📝 چکیده');
    lines.push(result.summary);
    lines.push('');
  }

  if (result?.criteria?.length) {
    lines.push('## 📊 نمره‌ی معیارها');
    lines.push('| معیار | نمره | توضیح |');
    lines.push('| --- | :---: | --- |');
    for (const item of result.criteria) {
      const value = item.score === null || item.score === undefined ? '—' : item.score;
      const comment = String(item.comment || '').replace(/\|/g, '/').replace(/\n+/g, ' ');
      lines.push(`| ${item.name} | ${value} | ${comment} |`);
    }
    lines.push('');
  }

  if (result?.sections?.length) {
    lines.push('## 🧩 بخش‌های مورد انتظار');
    lines.push('| بخش | وضعیت | توضیح |');
    lines.push('| --- | :---: | --- |');
    for (const item of result.sections) {
      const tone = SECTION_STATUS[item.status] || SECTION_STATUS.partial;
      const note = String(item.note || '').replace(/\|/g, '/').replace(/\n+/g, ' ');
      lines.push(`| ${item.title} | ${tone.mark} ${tone.label} | ${note} |`);
    }
    const counts = sectionSummary(result.sections);
    lines.push('');
    lines.push(
      `جمع: ${counts.total} مورد — موجود: ${counts.ok}، ناقص: ${counts.partial}، غایب: ${counts.missing}`
    );
    lines.push('');
  }

  if (result?.strengths?.length) {
    lines.push('## ✅ نقاط قوت');
    lines.push(...result.strengths.map((item) => `- ${item}`));
    lines.push('');
  }

  if (result?.weaknesses?.length) {
    lines.push('## ⚠️ نقاط ضعف');
    lines.push(...result.weaknesses.map((item) => `- ${item}`));
    lines.push('');
  }

  if (result?.suggestions?.length) {
    lines.push('## 🛠 پیشنهادهای بهبود');
    lines.push(...result.suggestions.map((item, index) => `${index + 1}. ${item}`));
    lines.push('');
  }

  if (result?.verdict) {
    lines.push('## 🎯 جمع‌بندی داور');
    lines.push(`> ${String(result.verdict).replace(/\n+/g, '\n> ')}`);
  }

  return lines.join('\n').trim();
}

