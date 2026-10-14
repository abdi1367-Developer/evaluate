/**
 * نقطه‌ی ورود تبدیل فایل به Markdown (معادل to_markdown در extractor.py).
 * همه‌چیز در مرورگر انجام می‌شود؛ هیچ فایلی به سرور آپلود نمی‌شود.
 */
import { normalizeMarkdown, textStats } from './text';
import { extractHeadings } from './headings';
import { parsePdf } from './pdf';
import { parseDocx } from './docx';

export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'md', 'markdown', 'txt'];
export const ACCEPT_ATTRIBUTE = '.pdf,.docx,.md,.markdown,.txt,application/pdf,text/plain,text/markdown';
export const MAX_FILE_MB = 80;

/** پسوند فایل را با حروف کوچک برمی‌گرداند */
export function fileExtension(name) {
  const clean = String(name || '').split(/[\\/]/).pop() || '';
  const index = clean.lastIndexOf('.');
  return index === -1 ? '' : clean.slice(index + 1).toLowerCase();
}

/** فایل متنی را با چند انکودینگ رایج (UTF-8 و Windows-1256) می‌خواند */
async function readPlainText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (const encoding of ['utf-8', 'windows-1256', 'windows-1252']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      // انکودینگ بعدی را امتحان کن
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * یک فایل را به Markdown تبدیل و سرفصل‌هایش را استخراج می‌کند.
 * @returns {Promise<{markdown: string, headings: Array, stats: object, notes: string[], pageCount: number|null, meta: object}>}
 */
export async function parseDocument(file, options = {}) {
  const { onProgress } = options;
  if (!file) throw new Error('هیچ فایلی انتخاب نشده است.');

  const extension = fileExtension(file.name);
  if (extension === 'doc') {
    throw new Error('فرمت قدیمی .doc پشتیبانی نمی‌شود؛ در Word فایل را با فرمت .docx ذخیره کنید.');
  }
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new Error(
      `پسوند «${extension || '؟'}» پشتیبانی نمی‌شود. فرمت‌های مجاز: PDF ، DOCX ، MD ، TXT`
    );
  }

  const notes = [];
  let markdown = '';
  let pageCount = null;

  if (onProgress) onProgress(`در حال خواندن «${file.name}» …`);

  if (extension === 'pdf') {
    const result = await parsePdf(await file.arrayBuffer(), { onProgress });
    markdown = result.markdown;
    pageCount = result.pageCount;
    notes.push(...result.notes);
  } else if (extension === 'docx') {
    const result = await parseDocx(await file.arrayBuffer());
    markdown = result.markdown;
    if (!result.headingCount && result.paragraphCount > 0) {
      notes.push(
        'در فایل Word سرفصلی با سبک Heading پیدا نشد؛ سرفصل‌ها از روی اندازه‌ی فونت و بولد بودن حدس زده شده‌اند.'
      );
    }
    if (!result.paragraphCount) {
      throw new Error('در فایل Word پاراگراف متنی پیدا نشد.');
    }
  } else {
    markdown = normalizeMarkdown(await readPlainText(file));
  }

  markdown = normalizeMarkdown(markdown);
  if (!markdown.trim()) {
    throw new Error(
      'متنی از فایل استخراج نشد. اگر PDF اسکن‌شده (تصویری) است، ابتدا باید با نرم‌افزار OCR به متن تبدیل شود.'
    );
  }

  const headings = extractHeadings(markdown);
  const stats = textStats(markdown, headings);

  return {
    markdown,
    headings,
    stats,
    notes,
    pageCount,
    meta: { name: file.name, size: file.size, extension },
  };
}
