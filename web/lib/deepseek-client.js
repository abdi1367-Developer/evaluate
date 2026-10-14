/**
 * گفت‌وگو با دیپ‌سیک از طریق مسیر امن سرور (/api/deepseek) و مدیریت مراحل تحلیل.
 *
 * نکته‌ی مهم برای Vercel: مراحل «خلاصه‌سازی هر بخش» و «داوری نهایی» از همین‌جا
 * (سمت مرورگر) پشت‌سرهم صدا زده می‌شوند؛ پس هر درخواست کوتاه است و از محدودیت
 * زمان اجرای توابع Vercel عبور نمی‌کنیم.
 */
import {
  DEFAULT_CHUNK_CHARS,
  DEFAULT_MAX_CHUNKS,
  DEFAULT_MAX_DIRECT_CHARS,
  buildCondensedDocument,
  estimateTokens,
  normalizeMarkdown,
  outlineToText,
  splitIntoChunks,
  truncateForDirect,
} from './text';
import {
  buildEvaluatorUserPrompt,
  buildStructureUserPrompt,
  buildSummaryUserPrompt,
  evaluatorMessages,
  structureMessages,
  summaryMessages,
} from './prompts';
import { normalizeResult, parseJsonResponse } from './result';
import { sectionsPromptText } from './sections';
import { MODELS } from './models';

export { MODELS };

const RETRYABLE_STATUS = [429, 500, 502, 503, 504];
const MAX_RETRIES = 2;
const NETWORK_ERROR_RE = /Failed to fetch|NetworkError|load failed|fetch failed|terminated/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** یک درخواست چت به مسیر سرور می‌فرستد (با تلاش دوباره در خطاهای موقت) */
export async function callChat({ messages, model, jsonMode = false, onWait }) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch('/api/deepseek', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, model, jsonMode }),
      });
      const data = await response.json().catch(() => null);

      if (response.ok) {
        const content = String(data?.content || '').trim();
        if (!content) throw new Error('پاسخ مدل خالی بود؛ دوباره تلاش کنید.');
        return content;
      }

      const message = data?.error || `خطای سرور (${response.status})`;
      if (RETRYABLE_STATUS.includes(response.status) && attempt < MAX_RETRIES) {
        lastError = new Error(message);
        if (onWait) onWait(`خطای موقت (${response.status}) — چند ثانیه بعد دوباره تلاش می‌شود …`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(message);
    } catch (error) {
      if (attempt < MAX_RETRIES && NETWORK_ERROR_RE.test(String(error?.message || ''))) {
        lastError = error;
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('ارتباط با دیپ‌سیک ناموفق بود.');
}

/**
 * کل جریان تحلیل را اجرا می‌کند:
 * متن کوتاه → یک‌جا داوری | متن بلند → خلاصه‌سازی بخش‌به‌بخش و سپس داوری.
 */
export async function runAnalysis(options) {
  const {
    markdown,
    headings = [],
    title = '',
    model = 'deepseek-chat',
    maxDirectChars = DEFAULT_MAX_DIRECT_CHARS,
    chunkChars = DEFAULT_CHUNK_CHARS,
    maxChunks = DEFAULT_MAX_CHUNKS,
    extraNote = '',
    expectedSections = [],
    onProgress = () => {},
  } = options;

  const text = String(markdown || '').trim();
  if (!text) throw new Error('متنی برای تحلیل وجود ندارد؛ اول فایل را تبدیل کنید.');

  const chars = text.length;
  const direct = chars <= maxDirectChars;
  const outlineText = outlineToText(headings);

  let judgeContent = '';
  let modeLabel = '';
  let truncated = false;
  const summaries = [];

  if (direct) {
    const result = truncateForDirect(text, maxDirectChars);
    judgeContent = result.text;
    truncated = result.truncated;
    modeLabel = truncated
      ? 'غیرکامل: ابتدا و انتهای متن (میانه به دلیل حجم زیاد حذف شده)'
      : 'متن کامل';
    onProgress(
      `متن کوتاه است (${chars.toLocaleString('fa-IR')} کاراکتر) → یک‌جا برای داوری ارسال می‌شود.`
    );
  } else {
    const chunks = splitIntoChunks(text, chunkChars, maxChunks);
    if (!chunks.length) throw new Error('تقسیم متن به بخش‌ها ناموفق بود.');
    onProgress(
      `متن بلند است (${chars.toLocaleString('fa-IR')} کاراکتر) → ` +
        `${chunks.length} بخش خلاصه می‌شود تا توکن کمتری مصرف شود.`
    );

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const headingMatch = chunk.match(/^#{1,6}[ \t]+(.+)$/m);
      const label = headingMatch ? headingMatch[1].trim().slice(0, 60) : '';
      onProgress(
        `خلاصه‌سازی بخش ${index + 1} از ${chunks.length}${label ? ` — ${label}` : ''} …`
      );
      const summary = await callChat({
        messages: summaryMessages(
          buildSummaryUserPrompt({
            content: chunk,
            index: index + 1,
            total: chunks.length,
            title,
            heading: label,
          })
        ),
        model,
        onWait: onProgress,
      });
      summaries.push({ title: label, summary });
    }

    judgeContent = buildCondensedDocument({
      title,
      headings,
      summaries,
      stats: {
        chars,
        words: text.split(/\s+/).filter(Boolean).length,
        tokens: estimateTokens(text),
      },
    });
    modeLabel = `غیرکامل: سرفصل‌ها + خلاصه‌ی ${summaries.length} بخش (صرفه‌جویی توکن)`;
  }

  onProgress('داوری و نمره‌دهی نهایی توسط دیپ‌سیک …');
  const raw = await callChat({
    messages: evaluatorMessages(
      buildEvaluatorUserPrompt({
        content: judgeContent,
        outlineText,
        expectedSections: sectionsPromptText(expectedSections),
        docTitle: title,
        modeNote: modeLabel,
        extraNote,
        originalChars: chars,
      })
    ),
    model,
    jsonMode: true,
    onWait: onProgress,
  });

  return {
    result: normalizeResult(parseJsonResponse(raw)),
    raw,
    model,
    mode: direct ? 'direct' : 'summarized',
    modeLabel,
    truncated,
    summaries,
    expectedSections: Array.isArray(expectedSections) ? expectedSections : [],
    chunkCount: summaries.length,
    originalChars: chars,
    judgeChars: judgeContent.length,
  };
}

/** اگر مدل خروجی را داخل بلوک کد گذاشته باشد، پاکش می‌کند */
function stripCodeFence(text) {
  const clean = String(text || '').trim();
  const fenced = clean.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/);
  return (fenced ? fenced[1] : clean).trim();
}

/**
 * متن استخراج‌شده را با دیپ‌سیک به Markdown تمیز و ساختاریافته تبدیل می‌کند
 * (مرحله‌ی اختیاری؛ وقتی تبدیل محلی سرفصل‌ها را خوب تشخیص نداده باشد مفید است).
 */
export async function structureToMarkdown({
  text,
  title = '',
  model = 'deepseek-chat',
  chunkChars = 14000,
  maxChunks = 10,
  onProgress = () => {},
}) {
  const source = String(text || '').trim();
  if (!source) throw new Error('متنی برای ساختاردهی وجود ندارد.');

  const chunks = splitIntoChunks(source, chunkChars, maxChunks);
  if (!chunks.length) throw new Error('تقسیم متن برای ساختاردهی ناموفق بود.');

  const parts = [];
  for (let index = 0; index < chunks.length; index += 1) {
    onProgress(`ساختاردهی Markdown با دیپ‌سیک — بخش ${index + 1} از ${chunks.length} …`);
    const answer = await callChat({
      messages: structureMessages(
        buildStructureUserPrompt({
          text: chunks[index],
          index: index + 1,
          total: chunks.length,
          title,
        })
      ),
      model,
      onWait: onProgress,
    });
    parts.push(stripCodeFence(answer));
  }

  const markdown = normalizeMarkdown(parts.join('\n\n'));
  if (!markdown.trim()) throw new Error('دیپ‌سیک خروجی Markdown نداد.');
  return { markdown, chunks: chunks.length };
}

