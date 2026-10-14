/**
 * استخراج سرفصل‌ها از Markdown (معادل extract_headings در extractor.py).
 */

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
// سطرهای شماره‌دار مثل «۱.۲. مقدمه» یا «3-2 روش کار»
const NUMBERED_RE = /^[\d۰-۹]+(?:[.\-–][\d۰-۹]+)*[.)\-–]?\s+\S.{0,80}$/;
const KEYWORDS = [
  'فصل',
  'بخش',
  'پیوست',
  'ضمیمه',
  'مقدمه',
  'پیش‌گفتار',
  'چکیده',
  'سرفصل',
  'نتیجه\\s*گیری',
  'جمع\\s*بندی',
  'فهرست',
  'مراجع',
  'منابع',
  'نمایه',
  'Abstract',
  'Chapter',
  'Part',
  'Section',
  'Introduction',
  'Conclusion',
];
// توجه: در جاوااسکریپت \b برای حروف فارسی کار نمی‌کند؛ به‌جایش جداکننده چک می‌شود.
const KEYWORD_RE = new RegExp(`^(?:${KEYWORDS.join('|')})(?=[\\s:：.،\\-–]|$).{0,80}$`, 'i');
const MAX_HEADINGS = 400;

/** پاک‌سازی عنوان سرفصل از نشانه‌های اضافه */
export function cleanTitle(text) {
  return String(text || '')
    .replace(/^\s*(?:[-*•·▪◦]|\d+[.)])\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/[`_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessHeadings(markdown) {
  const headings = [];
  let inCodeBlock = false;
  for (const raw of String(markdown || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || !line || line.length > 90) continue;
    if (KEYWORD_RE.test(line)) {
      headings.push({ level: 1, title: cleanTitle(line), source: 'heuristic' });
      continue;
    }
    if (NUMBERED_RE.test(line) && !/[.:،؛!?»\]]$/.test(line)) {
      headings.push({ level: 2, title: cleanTitle(line), source: 'heuristic' });
    }
    if (headings.length >= MAX_HEADINGS) break;
  }
  return headings;
}

/**
 * فهرست سرفصل‌ها را برمی‌گرداند: [{ level, title, source }]
 * اول سرفصل‌های واقعی Markdown (# و ##) و اگر نبود، با نشانه‌های متنی حدس می‌زند.
 */
export function extractHeadings(markdown) {
  const headings = [];
  for (const raw of String(markdown || '').split('\n')) {
    const match = raw.match(HEADING_RE);
    if (!match) continue;
    const title = cleanTitle(match[2]);
    if (title) headings.push({ level: match[1].length, title, source: 'markdown' });
    if (headings.length >= MAX_HEADINGS) break;
  }
  if (headings.length) return headings;
  return guessHeadings(markdown);
}

/** فهرست خطی سرفصل‌ها را به درخت تودرتو تبدیل می‌کند (برای نمایش در UI) */
export function buildOutlineTree(headings) {
  const roots = [];
  const stack = [];
  (headings || []).forEach((heading, index) => {
    const node = {
      id: `h-${index}`,
      title: heading.title,
      level: heading.level,
      source: heading.source,
      children: [],
    };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}
