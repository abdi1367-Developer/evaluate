/**
 * خواندن PDF **در مرورگر** با pdf.js.
 *
 * چرا در مرورگر؟ چون فایل به سرور آپلود نمی‌شود؛ پس محدودیت حجم ورکسل،
 * هزینه‌ی CPU توابع سرور و محدودیت زمانی آن هیچ‌کدام مشکلی ایجاد نمی‌کنند.
 *
 * منطق تشخیص سرفصل: اندازه‌ی فونت هر سطر با «اندازه‌ی غالب متن» مقایسه می‌شود
 * (همان کاری که نسخه‌ی پایتونی با PyMuPDF انجام می‌داد).
 */

const WORKER_LOCAL = '/pdf.worker.min.mjs';

const PAGE_NUMBER_RE = /^[\d۰-۹\s\-–—.()]+$/;
const BULLET_RE = /^[-–—•*·▪◦]\s+/;
const NUMBERED_LINE_RE = /^[\d۰-۹]+(?:[.\-–][\d۰-۹]+)*[.)\-–]\s+/;
const TERMINAL_RE = /[.:؛،!?»)\]"']$/;

/** یک worker تازه برای pdf.js می‌سازد (اول از فایل محلی، در صورت نبود از CDN) */
async function createPdfWorker(pdfjs) {
  try {
    const response = await fetch(WORKER_LOCAL);
    if (response.ok) {
      const type = (response.headers.get('content-type') || '').toLowerCase();
      const looksLikeJs = !type || type.includes('javascript') || type.includes('ecmascript');
      if (looksLikeJs) {
        return new Worker(WORKER_LOCAL, { type: 'module' });
      }
      // اگر سرور MIME اشتباه بدهد، کد را می‌گیریم و با Blob (MIME درست) اجرا می‌کنیم
      const code = await response.text();
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      return new Worker(blobUrl, { type: 'module' });
    }
  } catch {
    // ادامه با CDN
  }

  const cdnUrl = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const fallback = await fetch(cdnUrl);
  if (!fallback.ok) {
    throw new Error('فایل worker کتابخانه‌ی PDF در دسترس نیست (نه نسخه‌ی محلی و نه CDN).');
  }
  const code = await fallback.text();
  const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  return new Worker(blobUrl, { type: 'module' });
}

/** آیتم‌های متنی یک صفحه را به «سطر» تبدیل می‌کند */
function itemsToLines(items) {
  const lines = [];
  let current = null;

  const flush = () => {
    if (current && current.text.trim()) lines.push(current);
    current = null;
  };

  for (const item of items) {
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.abs(transform[3]) || item.height || 0;
    const x = transform[4] || 0;
    const y = transform[5] || 0;
    const text = typeof item.str === 'string' ? item.str : '';

    if (current && Math.abs(y - current.y) > Math.max(1.5, current.size * 0.4)) flush();
    if (!current) current = { text: '', size, y, sizeWeight: 0 };

    if (
      current.text &&
      text &&
      x - current.endX > Math.max(1, size * 0.28) &&
      !/\s$/.test(current.text) &&
      !/^\s/.test(text)
    ) {
      current.text += ' ';
    }

    current.text += text;
    current.endX = x + (item.width || 0);
    if (size > current.size) current.size = size;

    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/** اندازه‌ی فونت غالب متن (بر اساس مقدار متن نوشته‌شده با هر اندازه) */
function dominantFontSize(lines) {
  const weights = new Map();
  for (const line of lines) {
    const key = Math.round(line.size * 2) / 2;
    weights.set(key, (weights.get(key) || 0) + line.text.length);
  }
  let best = 12;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = size;
    }
  }
  return Math.max(1, best);
}

/** سطح سرفصل را از نسبت اندازه‌ی فونت به فونت غالب متن حدس می‌زند */
function headingLevel(line, bodySize) {
  const text = line.text.trim();
  if (!text || text.length > 120) return 0;
  const ratio = line.size / bodySize;
  let level = 0;
  if (ratio >= 1.6) level = 1;
  else if (ratio >= 1.35) level = 2;
  else if (ratio >= 1.15) level = 3;
  if (!level) return 0;
  // سطرهای بلند یا جملات تمام‌شده معمولاً سرفصل نیستند
  if (text.length > 60 && TERMINAL_RE.test(text)) return 0;
  return level;
}

/** سطرهای PDF را به Markdown تبدیل می‌کند (سرفصل + پاراگراف + فهرست) */
function linesToMarkdown(lines) {
  const bodySize = dominantFontSize(lines);
  const output = [];
  let paragraph = '';

  const flush = () => {
    if (paragraph.trim()) output.push(paragraph.trim());
    paragraph = '';
  };

  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (!text) {
      flush();
      continue;
    }
    if (PAGE_NUMBER_RE.test(text)) {
      flush();
      continue;
    }

    const level = headingLevel(line, bodySize);
    if (level) {
      flush();
      output.push(`${'#'.repeat(level)} ${text}`);
      continue;
    }

    if (BULLET_RE.test(text)) {
      flush();
      output.push(`- ${text.replace(BULLET_RE, '').trim()}`);
      continue;
    }
    if (NUMBERED_LINE_RE.test(text) && text.length <= 120) {
      flush();
      output.push(text);
      continue;
    }

    if (!paragraph) {
      paragraph = text;
      continue;
    }
    if (TERMINAL_RE.test(paragraph)) {
      flush();
      paragraph = text;
      continue;
    }
    // ادامه‌ی همان پاراگراف: شکست خط PDF حذف می‌شود (صرفه‌جویی در توکن)
    if (/[A-Za-zآ-ی]-$/.test(paragraph)) {
      paragraph = `${paragraph.replace(/-$/, '')}${text}`;
    } else {
      paragraph = `${paragraph} ${text}`;
    }
  }
  flush();

  return output.join('\n\n').trim();
}

/**
 * متن PDF را استخراج می‌کند.
 * @returns {{ markdown: string, pageCount: number, notes: string[] }}
 */
export async function parsePdf(arrayBuffer, options = {}) {
  const { maxPages = 800, onProgress } = options;
  const pdfjs = await import('pdfjs-dist');
  const worker = await createPdfWorker(pdfjs);
  let doc = null;

  try {
    pdfjs.GlobalWorkerOptions.workerPort = worker;
    const task = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });
    doc = await task.promise;

    const pageCount = doc.numPages;
    const limit = Math.min(pageCount, Math.max(1, maxPages));
    const lines = [];

    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageLines = itemsToLines(content.items);
      for (const line of pageLines) lines.push(line);
      if (onProgress && (pageNumber % 10 === 0 || pageNumber === limit)) {
        onProgress(`خواندن صفحه ${pageNumber} از ${limit} …`);
      }
    }

    const notes = [];
    if (pageCount > limit) {
      notes.push(`فقط ${limit} صفحه‌ی اول از کل ${pageCount} صفحه پردازش شد.`);
    }

    return { markdown: linesToMarkdown(lines), pageCount, notes };
  } finally {
    try {
      if (doc) await doc.destroy();
    } catch {
      // بی‌اهمیت
    }
    try {
      worker.terminate();
    } catch {
      // بی‌اهمیت
    }
    pdfjs.GlobalWorkerOptions.workerPort = null;
  }
}
