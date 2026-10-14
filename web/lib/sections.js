/**
 * سرفصل‌های «مورد انتظار» برای مقاله، کتاب و گزارش/پایان‌نامه.
 * پیش‌فرض‌اند، در پنل قابل ویرایش‌اند و پیش از تحلیل به کاربر نشان داده می‌شوند
 * تا خودش تعیین کند داور کدام بخش‌ها را بررسی کند.
 * شکل هر آیتم: { title: 'چکیده', common: true }  // common = پیش‌فرض تیک‌خورده
 */

export const DOC_TYPES = [
  { id: 'article', label: 'مقاله', icon: '📄' },
  { id: 'book', label: 'کتاب', icon: '📘' },
  { id: 'other', label: 'گزارش / پایان‌نامه', icon: '🗂' },
];

export const DEFAULT_SECTION_GROUPS = {
  article: [
    {
      id: 'meta',
      title: 'اطلاعات پایه',
      items: [
        { title: 'عنوان', common: true },
        { title: 'نویسندگان و وابستگی سازمانی', common: false },
        { title: 'چکیده', common: true },
        { title: 'واژگان کلیدی', common: true },
      ],
    },
    {
      id: 'intro',
      title: 'مقدمه و بیان مسئله',
      items: [
        { title: 'مقدمه', common: true },
        { title: 'بیان مسئله', common: true },
        { title: 'اهمیت و ضرورت پژوهش', common: false },
        { title: 'اهداف و سؤال‌های پژوهش', common: false },
        { title: 'فرضیه‌ها و پیش‌فرض‌ها', common: false },
        { title: 'تعریف واژه‌های کلیدی', common: false },
      ],
    },
    {
      id: 'theory',
      title: 'پیشینه و مبانی نظری',
      items: [
        { title: 'مرور پیشینه پژوهش', common: true },
        { title: 'مبانی نظری', common: false },
        { title: 'مدل مفهومی / چارچوب پژوهش', common: true },
      ],
    },
    {
      id: 'method',
      title: 'روش پژوهش',
      items: [
        { title: 'روش و نوع پژوهش', common: true },
        { title: 'جامعه، نمونه و روش نمونه‌گیری', common: false },
        { title: 'ابزار گردآوری داده‌ها', common: false },
        { title: 'روایی و پایایی ابزار', common: false },
        { title: 'روش تحلیل داده‌ها', common: false },
      ],
    },
    {
      id: 'findings',
      title: 'یافته‌ها و بحث',
      items: [
        { title: 'یافته‌ها و نتایج', common: true },
        { title: 'جداول و شکل‌ها', common: false },
        { title: 'بحث و تفسیر', common: true },
        { title: 'مقایسه با پژوهش‌های پیشین', common: false },
      ],
    },
    {
      id: 'end',
      title: 'پایان‌بندی و منابع',
      items: [
        { title: 'نتیجه‌گیری', common: true },
        { title: 'محدودیت‌های پژوهش', common: false },
        { title: 'پیشنهادهای پژوهشی', common: false },
        { title: 'کاربردهای عملی', common: false },
        { title: 'منابع', common: true },
        { title: 'پیوست‌ها', common: false },
      ],
    },
  ],
  book: [
    {
      id: 'meta',
      title: 'اطلاعات پایه',
      items: [
        { title: 'عنوان کتاب', common: true },
        { title: 'نویسنده / مترجم', common: true },
        { title: 'ناشر، نوبت و سال چاپ', common: false },
        { title: 'فهرست مطالب', common: true },
      ],
    },
    {
      id: 'front',
      title: 'بخش‌های آغازین',
      items: [
        { title: 'تقدیم / سپاس‌گزاری', common: false },
        { title: 'پیش‌گفتار', common: true },
        { title: 'مقدمه', common: true },
        { title: 'طرح کلی و هدف کتاب', common: false },
      ],
    },
    {
      id: 'body',
      title: 'بدنه و فصل‌ها',
      items: [
        { title: 'فصل‌بندی منظم', common: true },
        { title: 'چکیده یا معرفی هر فصل', common: false },
        { title: 'اهداف هر فصل', common: false },
        { title: 'نتیجه‌گیری هر فصل', common: false },
        { title: 'پرسش‌ها و تمرین‌های پایان فصل', common: false },
      ],
    },
    {
      id: 'deep',
      title: 'محتوا و تحلیل',
      items: [
        { title: 'مبانی نظری', common: true },
        { title: 'مثال‌ها و مطالعه‌ی موردی', common: false },
        { title: 'جداول، نمودارها و تصاویر', common: false },
        { title: 'جمع‌بندی کل کتاب', common: true },
      ],
    },
    {
      id: 'end',
      title: 'بخش‌های پایانی',
      items: [
        { title: 'منابع', common: true },
        { title: 'واژه‌نامه', common: false },
        { title: 'نمایه (ایندکس)', common: false },
        { title: 'پیوست‌ها', common: false },
      ],
    },
  ],
  other: [
    {
      id: 'meta',
      title: 'اطلاعات پایه',
      items: [
        { title: 'عنوان', common: true },
        { title: 'تهیه‌کننده / نویسنده', common: false },
        { title: 'چکیده‌ی مدیریتی', common: true },
        { title: 'فهرست مطالب', common: true },
      ],
    },
    {
      id: 'body',
      title: 'ساختار اصلی',
      items: [
        { title: 'مقدمه', common: true },
        { title: 'اهداف و دامنه', common: true },
        { title: 'روش و رویکرد انجام کار', common: false },
        { title: 'بدنه و فصل‌ها', common: false },
        { title: 'جمع‌بندی و نتیجه‌گیری', common: true },
      ],
    },
    {
      id: 'end',
      title: 'پایان‌بندی',
      items: [
        { title: 'پیشنهادها', common: false },
        { title: 'منابع', common: true },
        { title: 'پیوست‌ها', common: false },
      ],
    },
  ],
};

/** یک نسخه‌ی مستقل (بدون اشتراک با پیش‌فرض‌ها) از گروه‌ها می‌سازد */
export function cloneGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((group, index) => ({
    id: String(group?.id || `g${index + 1}`),
    title: String(group?.title || `گروه ${index + 1}`).trim(),
    items: (Array.isArray(group?.items) ? group.items : [])
      .map((item) => {
        const title = String((item && typeof item === 'object' ? item.title : item) || '').trim();
        return { title, common: Boolean(item && typeof item === 'object' ? item.common : false) };
      })
      .filter((item) => item.title),
  }));
}

export function defaultGroupsFor(docType) {
  return cloneGroups(DEFAULT_SECTION_GROUPS[docType] || DEFAULT_SECTION_GROUPS.article);
}

/** نقشه‌ی سرفصل‌ها برای هر نوع سند (نوع‌های ناقص از پیش‌فرض پر می‌شوند) */
export function ensureSectionMap(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const map = {};
  for (const type of DOC_TYPES) {
    const groups = cloneGroups(source[type.id]);
    map[type.id] = groups.length ? groups : defaultGroupsFor(type.id);
  }
  return map;
}

export function allTitles(groups) {
  const seen = new Set();
  const titles = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const item of group?.items || []) {
      const title = String(item?.title || '').trim();
      if (title && !seen.has(title)) {
        seen.add(title);
        titles.push(title);
      }
    }
  }
  return titles;
}

export function defaultSelection(groups) {
  const titles = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const item of group?.items || []) {
      if (item?.common && item?.title) titles.push(item.title);
    }
  }
  return titles.length ? titles : allTitles(groups);
}

export function selectedInOrder(groups, selection) {
  const set = new Set(Array.isArray(selection) ? selection : []);
  return allTitles(groups).filter((title) => set.has(title));
}

/** فهرست سرفصل‌های انتخاب‌شده به شکل متن برای پرامپت */
export function sectionsPromptText(titles) {
  return (Array.isArray(titles) ? titles : [])
    .map((title) => String(title).trim())
    .filter(Boolean)
    .map((title) => `- ${title}`)
    .join('\n');
}

/** حدس نوع سند از متن و نام فایل (برای پیش‌انتخاب تب مقاله/کتاب) */
export function guessDocType(markdown, fileName = '') {
  const text = String(markdown || '');
  const head = `${text.slice(0, 8000)} ${String(fileName || '')}`.toLowerCase();
  const articleSignals = ['چکیده', 'واژگان کلیدی', 'abstract', 'keywords', 'بیان مسئله', 'روش پژوهش'];
  const bookSignals = ['پیش‌گفتار', 'فهرست مطالب', 'شابک', 'isbn', 'ناشر', 'ویراستار'];
  const chapters = (text.match(/^#{1,4}\s*(فصل|بخش|chapter|part)\b/gim) || []).length;
  const article = articleSignals.filter((signal) => head.includes(signal)).length;
  const book = bookSignals.filter((signal) => head.includes(signal)).length;
  if (chapters >= 3 || book >= 2) return 'book';
  if (article >= 2) return 'article';
  return 'other';
}

/** متن پنل → آیتم‌ها (هر خط یک سرفصل؛ خطوط آغازشده با * پیش‌فرض تیک‌خورده‌اند) */
export function parseItemsText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ common: /^\*/.test(line), title: line.replace(/^\*\s*/, '').trim() }))
    .filter((item) => item.title);
}

/** آیتم‌ها → متن قابل ویرایش در پنل */
export function itemsToText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item?.common ? '* ' : ''}${item?.title || ''}`.trim())
    .filter(Boolean)
    .join('\n');
}

