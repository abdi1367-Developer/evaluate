/**
 * ابزارهای متنی: تخمین توکن، پاک‌سازی Markdown، برش و تقسیم متن.
 * این فایل معادل بخش متن‌محورِ extractor.py و برنامه‌ریزی ارسال analyzer.py است.
 */

export const DEFAULT_MAX_DIRECT_CHARS = 60000;
export const DEFAULT_CHUNK_CHARS = 35000;
export const DEFAULT_MAX_CHUNKS = 10;

const HEADING_SPLIT_RE = /(?=^#{1,6}[ \t])/m;

/** تخمین محافظه‌کارانه‌ی تعداد توکن (فارسی ~۳ کاراکتر برای هر توکن) */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.floor(text.length / 3) + 1;
}

/** پاک‌سازی متن Markdown: یکسان‌سازی خطوط و حذف فاصله‌های اضافه */
export function normalizeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** آمار کوتاه متن برای نمایش در رابط کاربری */
export function textStats(markdown, headings = []) {
  const text = markdown || '';
  const levels = {};
  for (const heading of headings) {
    levels[heading.level] = (levels[heading.level] || 0) + 1;
  }
  return {
    chars: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    tokens: estimateTokens(text),
    headings: headings.length,
    levels,
  };
}

/** اگر متن از حد مجاز بزرگ‌تر باشد، ۷۰٪ ابتدا و ۳۰٪ انتها نگه داشته می‌شود */
export function truncateForDirect(markdown, maxDirectChars) {
  const text = markdown || '';
  const limit = Math.max(1000, Number(maxDirectChars) || DEFAULT_MAX_DIRECT_CHARS);
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  const headLength = Math.floor(limit * 0.7);
  const tailLength = limit - headLength;
  return {
    text:
      `${text.slice(0, headLength)}\n\n` +
      '... [میانه‌ی سند برای صرفه‌جویی در توکن حذف شد] ...\n\n' +
      text.slice(-tailLength),
    truncated: true,
  };
}

/** یک بلوک بسیار بلند را با مرز پاراگراف و در نهایت کاراکتر می‌شکند */
function splitLongBlock(block, limit) {
  const pieces = [];
  let current = '';
  for (const paragraph of block.split('\n\n')) {
    if (paragraph.length > limit) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      for (let index = 0; index < paragraph.length; index += limit) {
        pieces.push(paragraph.slice(index, index + limit));
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > limit) {
      pieces.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** تعداد قطعه‌ها را با ادغام قطعه‌های مجاور به تعداد هدف کاهش می‌دهد */
function mergeChunks(chunks, targetCount) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const targetSize = Math.max(1, Math.floor(total / Math.max(1, targetCount)));
  const merged = [];
  let current = '';
  for (const chunk of chunks) {
    if (current && current.length + chunk.length > targetSize && merged.length < targetCount - 1) {
      merged.push(current);
      current = chunk;
    } else {
      current += chunk;
    }
  }
  if (current) merged.push(current);
  return merged.filter((chunk) => chunk.trim());
}

/** متن را با مرز سرفصل‌ها به قطعه‌های هم‌اندازه تقسیم می‌کند */
export function splitIntoChunks(markdown, chunkChars, maxChunks) {
  const limit = Math.max(1000, Number(chunkChars) || DEFAULT_CHUNK_CHARS);
  const cap = Math.max(1, Number(maxChunks) || DEFAULT_MAX_CHUNKS);
  const blocks = (markdown || '').split(HEADING_SPLIT_RE).filter(Boolean);

  const expanded = [];
  for (const block of blocks) {
    if (block.length <= limit) expanded.push(block);
    else expanded.push(...splitLongBlock(block, limit));
  }

  const chunks = [];
  let current = '';
  for (const block of expanded) {
    if (current && current.length + block.length > limit) {
      chunks.push(current);
      current = block;
    } else {
      current += block;
    }
  }
  if (current) chunks.push(current);

  const cleaned = chunks.filter((chunk) => chunk.trim());
  if (!cleaned.length) return [];
  if (cleaned.length > cap) return mergeChunks(cleaned, cap);
  return cleaned;
}

/** سرفصل‌ها را به متن تودرتو (برای ارسال به مدل) تبدیل می‌کند */
export function outlineToText(headings) {
  return (headings || [])
    .map((heading) => `${'  '.repeat(Math.max(0, (heading.level || 1) - 1))}- ${heading.title}`)
    .join('\n');
}

/**
 * «سند فشرده» می‌سازد: سرفصل‌ها + خلاصه‌ی هر بخش.
 * همین متن (به‌جای صدها صفحه متن کامل) برای داوری نهایی فرستاده می‌شود.
 */
export function buildCondensedDocument({ title, headings, summaries, stats }) {
  const parts = [];
  parts.push('# سند فشرده‌شده برای داوری');
  parts.push('');
  parts.push('## مشخصات فنی');
  parts.push(`- نام فایل: ${title || 'نامشخص'}`);
  parts.push(`- حجم متن اصلی: ${Number(stats?.chars || 0).toLocaleString('fa-IR')} کاراکتر`);
  parts.push(`- تعداد واژه: ${Number(stats?.words || 0).toLocaleString('fa-IR')}`);
  parts.push(`- توکن تخمینی متن اصلی: ${Number(stats?.tokens || 0).toLocaleString('fa-IR')}`);
  parts.push(
    `- روش تهیه: متن بلند بوده، ابتدا به ${summaries.length} بخش تقسیم و هر بخش خلاصه شده است.`
  );
  parts.push('');

  const outline = outlineToText(headings);
  if (outline.trim()) {
    parts.push('## فهرست سرفصل‌های شناسایی‌شده');
    parts.push(outline.trim());
    parts.push('');
  }

  parts.push('## خلاصه‌ی بخش‌ها');
  summaries.forEach((item, index) => {
    parts.push(`### بخش ${index + 1}${item.title ? ` — ${item.title}` : ''}`);
    parts.push((item.summary || '').trim());
    parts.push('');
  });

  return parts.join('\n').trim();
}
