/**
 * خواندن فایل Word (.docx) **در مرورگر**.
 *
 * روش کار: فایل DOCX یک «زیپ» است که داخلش word/document.xml قرار دارد.
 * با fflate زیپ را باز می‌کنیم و با DOMParser خود مرورگر، ساختار XML را می‌خوانیم.
 * بنابراین هیچ کتابخانه‌ی سنگینی لازم نیست (به‌جای mammoth که چند مگابایت است).
 */
import { unzipSync, strFromU8 } from 'fflate';
import { normalizeMarkdown } from './text';

/** مقدار یک ویژگی XML را مستقل از پیشوند فضای‌نام برمی‌گرداند */
function attr(element, name) {
  if (!element || !element.attributes) return '';
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === name) return attribute.value;
  }
  return '';
}

function firstChild(element, localName) {
  if (!element) return null;
  for (const child of Array.from(element.children || [])) {
    if (child.localName === localName) return child;
  }
  return null;
}

function descendants(element, localName) {
  if (!element) return [];
  return Array.from(element.getElementsByTagName('*')).filter(
    (node) => node.localName === localName
  );
}

/** متن یک پاراگراف Word را استخراج می‌کند (شامل تب و شکست خط) */
function paragraphText(paragraph) {
  let output = '';
  const walk = (node) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType !== 1) continue;
      const name = child.localName;
      if (name === 't') output += child.textContent || '';
      else if (name === 'delText' || name === 'instrText' || name === 'fldChar') continue;
      else if (name === 'tab') output += '\t';
      else if (name === 'br' || name === 'cr') output += ' ';
      else if (name === 'noBreakHyphen') output += '-';
      else if (name === 'softHyphen') continue;
      else walk(child);
    }
  };
  walk(paragraph);
  return output;
}

function isBoldRun(element) {
  const value = attr(element, 'val');
  return value === '' || value === '1' || value === 'true' || value === undefined;
}

/**
 * سطح سرفصل یک پاراگراف: ۰ یعنی متن معمولی.
 * اول سبک Heading (یا outlineLvl) و در نبود آن اندازه‌ی فونت/بولد چک می‌شود.
 */
function paragraphHeadingLevel(paragraph, pPr) {
  const outlineLevel = firstChild(pPr, 'outlineLvl');
  if (outlineLevel) {
    const value = Number(attr(outlineLevel, 'val'));
    if (Number.isFinite(value) && value >= 0 && value <= 8) return Math.min(6, value + 1);
  }

  const pStyle = firstChild(pPr, 'pStyle');
  const styleKey = attr(pStyle, 'val').replace(/[\s_-]/g, '').toLowerCase();
  if (styleKey) {
    const headingMatch = styleKey.match(/^heading([1-9])$/) || styleKey.match(/^h([1-9])$/);
    if (headingMatch) return Math.min(6, Number(headingMatch[1]));
    if (styleKey === 'title') return 1;
    if (styleKey === 'subtitle') return 2;
  }

  const halfPoints = descendants(paragraph, 'sz')
    .map((node) => Number(attr(node, 'val')))
    .filter((value) => Number.isFinite(value) && value > 0);
  const points = halfPoints.length ? Math.max(...halfPoints) / 2 : 0;
  const text = paragraphText(paragraph).trim();
  const bold = descendants(paragraph, 'b').some(isBoldRun);

  if (points >= 16) return 1;
  if (points >= 14) return 2;
  if (bold && text.length > 0 && text.length <= 70 && !/[.:؛،!?]$/.test(text)) return 3;
  return 0;
}

/** یک جدول Word را به جدول Markdown تبدیل می‌کند */
function tableToMarkdown(table) {
  const rows = [];
  for (const row of Array.from(table.children || [])) {
    if (row.localName !== 'tr') continue;
    const cells = [];
    for (const cell of Array.from(row.children || [])) {
      if (cell.localName !== 'tc') continue;
      const texts = [];
      for (const paragraph of Array.from(cell.children || [])) {
        if (paragraph.localName !== 'p') continue;
        const text = paragraphText(paragraph).replace(/\s+/g, ' ').trim();
        if (text) texts.push(text);
      }
      cells.push(texts.join(' ').replace(/\|/g, '/'));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return '';

  const width = Math.max(...rows.map((row) => row.length));
  const lines = rows.map(
    (cells) => `| ${cells.concat(Array(width - cells.length).fill('')).join(' | ')} |`
  );
  lines.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
  return lines.join('\n');
}

/**
 * متن فایل DOCX را به Markdown تبدیل می‌کند.
 * @returns {{ markdown: string, paragraphCount: number, headingCount: number }}
 */
export async function parseDocx(arrayBuffer) {
  let zip;
  try {
    zip = unzipSync(new Uint8Array(arrayBuffer), {
      filter: (file) => /^word\/document\d*\.xml$/i.test(file.name),
    });
  } catch (error) {
    throw new Error(
      `فایل DOCX باز نشد (${error?.message || error}). مطمئن شوید فایل Word سالم و با فرمت .docx است.`
    );
  }

  const entry =
    zip['word/document.xml'] ||
    Object.entries(zip).find(([name]) => /^word\/document\d*\.xml$/i.test(name))?.[1];
  if (!entry) {
    throw new Error('این فایل یک DOCX معتبر نیست (فایل word/document.xml داخل آن پیدا نشد).');
  }

  const document = new DOMParser().parseFromString(strFromU8(entry), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw new Error('خواندن ساختار XML سند Word ناموفق بود.');
  }

  const body =
    Array.from(document.documentElement.children).find((node) => node.localName === 'body') ||
    document.documentElement;

  // پاراگراف‌ها و جدول‌ها را به ترتیب متن جمع می‌کنیم (حتا داخل کادرهای متن)
  const blocks = [];
  const collect = (parent) => {
    for (const node of Array.from(parent.children || [])) {
      const name = node.localName;
      if (name === 'p') blocks.push({ type: 'p', node });
      else if (name === 'tbl') blocks.push({ type: 'tbl', node });
      else if (['sdt', 'sdtContent', 'txbxContent', 'body', 'txbx', 'hdr', 'ftr'].includes(name)) {
        collect(node);
      }
    }
  };
  collect(body);

  const lines = [];
  let headingCount = 0;
  for (const block of blocks) {
    if (block.type === 'tbl') {
      const markdown = tableToMarkdown(block.node);
      if (markdown) lines.push(markdown, '');
      continue;
    }

    const paragraph = block.node;
    const pPr = firstChild(paragraph, 'pPr');
    const text = paragraphText(paragraph).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const level = paragraphHeadingLevel(paragraph, pPr);
    if (level) {
      lines.push(`${'#'.repeat(level)} ${text}`, '');
      headingCount += 1;
      continue;
    }
    if (firstChild(pPr, 'numPr')) {
      lines.push(`- ${text}`);
      continue;
    }
    lines.push(text, '');
  }

  return {
    markdown: normalizeMarkdown(lines.join('\n')),
    paragraphCount: blocks.filter((block) => block.type === 'p').length,
    headingCount,
  };
}

