/**
 * پرامپت‌های دیپ‌سیک (عیناً همان پرامپت‌های analyzer.py تا نتیجه یکسان باشد).
 */
import { estimateTokens } from './text';

export const EVALUATOR_SYSTEM_PROMPT = `تو یک «داور» (Reviewer) حرفه‌ای، بی‌طرف و باتجربه برای مقاله‌های علمی و کتاب‌های تخصصی هستی.
وظیفه‌ات این است که متن داده‌شده را بخوانی، درباره‌ی کیفیت آن اعلام نظر کنی و نمره بدهی.

قواعد:
۱) فقط بر اساس متنی که در اختیار داری قضاوت کن و چیزی از خودت اضافه نکن.
۲) اگر متن کامل نبود (مثلاً خلاصه‌ی بخش‌ها به تو داده شده)، این نکته را در جمع‌بندی بگو.
۳) نمره را واقع‌بینانه بده: متن معمولی حدود ۵۰ تا ۷۰، متن خوب ۷۰ تا ۸۵ و متن عالی بالای ۸۵.
   نمره‌ی معیارها را متنوع بده، نه یکنواخت.
۴) همه‌ی خروجی‌ها باید فارسی روان باشند.
۵) خروجی را «فقط» به صورت یک شیء json معتبر بده؛ هیچ توضیح یا متن اضافه‌ای پیش و پس از json نگذار.

ساختار دقیق json:
{
  "score": <عدد صحیح 0 تا 100>,
  "grade": "<یکی از: ضعیف | قابل قبول | خوب | خیلی خوب | عالی>",
  "criteria": [
    {"name": "ساختار و سرفصل‌بندی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "محتوا و عمق علمی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "انسجام و نظم منطقی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "نگارش و ویرایش زبانی", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "ارجاع‌دهی و اصالت", "score": <0-100>, "comment": "<یک تا دو جمله>"},
    {"name": "کاربردی‌بودن برای خواننده‌ی هدف", "score": <0-100>, "comment": "<یک تا دو جمله>"}
  ],
  "summary": "<چکیده‌ی کوتاه متن در ۳ تا ۵ خط>",
  "strengths": ["<نقطه‌ی قوت>", "<نقطه‌ی قوت>"],
  "weaknesses": ["<نقطه‌ی ضعف>", "<نقطه‌ی ضعف>"],
  "suggestions": ["<پیشنهاد عملی و قابل اجرا>", "<پیشنهاد عملی>"],
  "verdict": "<جمع‌بندی نهایی در ۲ تا ۳ خط، همراه با نمره و دلیل اصلی آن>"
}`;

export const SUMMARY_SYSTEM_PROMPT = `تو یک خلاصه‌ساز دقیق و امانت‌دار هستی و بخشی از یک مقاله/کتاب به تو داده می‌شود.
آن را به فارسی و در قالب نکات کلیدی فشرده خلاصه کن.
- سرفصل‌ها و زیربخش‌های همان بخش را حفظ کن.
- ادعاها، داده‌ها، اعداد، روش‌ها و نتیجه‌گیری‌های مهم را نگه دار و مطالب تکراری یا کم‌اهمیت را حذف کن.
- چیزی از خودت اضافه نکن و به متن وفادار بمان.
- خروجی حداکثر حدود ۲۵۰ واژه باشد و با Markdown ساده (فهرست نقطه‌ای) نوشته شود.`;

/** پرامپت کاربر برای مرحله‌ی خلاصه‌سازی یک بخش از سند بلند */
export function buildSummaryUserPrompt({ content, index, total, title, heading }) {
  const parts = [
    `بخش ${index} از ${total} سند «${title || 'بدون عنوان'}» را خلاصه کن.`,
  ];
  if (heading) parts.push(`سرفصل این بخش: ${heading}`);
  parts.push('', '=== متن بخش ===', content, '=== پایان بخش ===');
  return parts.join('\n');
}

/** پرامپت کاربر برای مرحله‌ی داوری نهایی */
export function buildEvaluatorUserPrompt({
  content,
  outlineText = '',
  docTitle = '',
  modeNote = '',
  extraNote = '',
  originalChars = 0,
}) {
  const parts = [
    'مشخصات سند:',
    `- عنوان فایل: ${docTitle || 'نامشخص'}`,
    `- حجم متن اصلی: حدود ${Math.max(originalChars, content.length).toLocaleString('en-US')} کاراکتر ` +
      `(≈ ${estimateTokens(content).toLocaleString('en-US')} توکن)`,
    `- نحوه‌ی در اختیار گذاشتن متن: ${modeNote || 'متن کامل'}`,
  ];
  if (extraNote && extraNote.trim()) {
    parts.push(`- تأکید کارفرما: ${extraNote.trim()}`);
  }
  if (outlineText && outlineText.trim()) {
    parts.push('', 'سرفصل‌های شناسایی‌شده:', outlineText.trim());
  }
  parts.push('', '=== متن سند ===', content, '=== پایان متن سند ===');
  parts.push('', 'الان این سند را ارزیابی کن و خروجی json را بده.');
  return parts.join('\n');
}

/** پیام‌های آماده برای ارسال به API */
export function evaluatorMessages(userPrompt) {
  return [
    { role: 'system', content: EVALUATOR_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

export function summaryMessages(userPrompt) {
  return [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}
